from __future__ import annotations

import logging
import threading
import time

import requests

from backend.services.finops import estimate_tokens
from backend.utils.metrics import record_error

_gateway_state = threading.local()
_capability_lock = threading.Lock()
_endpoint_capabilities: dict[str, dict] = {}
logger = logging.getLogger(__name__)
ENDPOINT_CACHE_TTL_SEC = 60


class OllamaUnavailableError(RuntimeError):
    pass


class OllamaTimeoutError(OllamaUnavailableError):
    pass


def get_last_gateway_result() -> dict:
    return getattr(_gateway_state, "result", {}).copy()


def reset_endpoint_capabilities() -> None:
    with _capability_lock:
        _endpoint_capabilities.clear()


class OllamaGateway:
    def __init__(self, base_url, model, timeout, fallback_model=None):
        self.base_url = str(base_url or "http://localhost:11434").rstrip("/")
        self.model = model
        self.timeout = timeout
        self.fallback_model = fallback_model

    def _set_last_result(self, **kwargs):
        _gateway_state.result = kwargs

    def _capability_snapshot(self) -> dict:
        now = time.time()
        with _capability_lock:
            current = _endpoint_capabilities.get(self.base_url)
            if not current:
                current = {"preferred": None, "endpoints": {}}
                _endpoint_capabilities[self.base_url] = current

            fresh_endpoints = {}
            for endpoint, status in current.get("endpoints", {}).items():
                checked_at = float(status.get("checked_at", 0) or 0)
                if now - checked_at < ENDPOINT_CACHE_TTL_SEC:
                    fresh_endpoints[endpoint] = status
            current["endpoints"] = fresh_endpoints
            return {
                "preferred": current.get("preferred"),
                "endpoints": {key: value.copy() for key, value in fresh_endpoints.items()},
            }

    def _remember_endpoint_status(self, endpoint: str, *, supported: bool, status_code: int | None = None):
        with _capability_lock:
            current = _endpoint_capabilities.setdefault(self.base_url, {"preferred": None, "endpoints": {}})
            current["endpoints"][endpoint] = {
                "supported": supported,
                "status_code": status_code,
                "checked_at": time.time(),
            }
            if supported:
                current["preferred"] = endpoint
            elif current.get("preferred") == endpoint:
                current["preferred"] = None

    @staticmethod
    def _normalize_model_name(name: str) -> str:
        return str(name or "").strip().lower().removesuffix(":latest")

    def _resolve_candidate_models(self, available_models: list[str]) -> list[str]:
        normalized_map = {
            self._normalize_model_name(model_name): model_name
            for model_name in available_models
            if model_name
        }

        requested = normalized_map.get(self._normalize_model_name(self.model), self.model)
        candidates = [requested]

        if self.fallback_model:
            fallback = normalized_map.get(self._normalize_model_name(self.fallback_model), self.fallback_model)
            if fallback not in candidates:
                candidates.append(fallback)

        if requested != self.model:
            logger.info("Resolved Ollama model '%s' to installed tag '%s'.", self.model, requested)

        if requested == self.model and available_models and self._normalize_model_name(self.model) not in normalized_map:
            logger.warning(
                "Configured Ollama model '%s' is unavailable. Falling back to '%s'.",
                self.model,
                candidates[1] if len(candidates) > 1 else self.model,
            )

        return candidates

    def _post(self, endpoint: str, payload: dict) -> dict:
        try:
            response = requests.post(f"{self.base_url}{endpoint}", json=payload, timeout=self.timeout)
            response.raise_for_status()
            self._remember_endpoint_status(endpoint, supported=True, status_code=response.status_code)
            return response.json()
        except requests.exceptions.Timeout as exc:
            self._set_last_result(endpoint_used=endpoint, timeout=True)
            record_error()
            raise OllamaTimeoutError(f"Ollama request timed out at {endpoint}") from exc
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code == 404:
                self._remember_endpoint_status(endpoint, supported=False, status_code=status_code)
            raise OllamaUnavailableError(str(exc)) from exc
        except requests.RequestException as exc:
            raise OllamaUnavailableError(str(exc)) from exc

    def _build_attempts(self, prompt: str, messages: list[dict], system: str | None, num_predict: int, model_name: str) -> list[tuple[str, dict, callable]]:
        return [
            (
                "/api/chat",
                {
                    "model": model_name,
                    "messages": messages,
                    "stream": False,
                    "options": {"num_predict": num_predict},
                },
                lambda data: (data.get("message") or {}).get("content", "").strip(),
            ),
            (
                "/api/generate",
                {
                    "model": model_name,
                    "prompt": prompt,
                    "system": system,
                    "stream": False,
                    "num_predict": num_predict,
                },
                lambda data: data.get("response", "").strip(),
            ),
            (
                "/v1/completions",
                {
                    "model": model_name,
                    "prompt": prompt,
                    "max_tokens": num_predict,
                },
                lambda data: ((data.get("choices") or [{}])[0].get("text", "")).strip(),
            ),
        ]

    def _ordered_attempts(self, attempts: list[tuple[str, dict, callable]]) -> list[tuple[str, dict, callable]]:
        snapshot = self._capability_snapshot()
        preferred = snapshot.get("preferred")
        known = snapshot.get("endpoints", {})

        ordered = []
        attempted = set()

        if preferred:
            for attempt in attempts:
                if attempt[0] == preferred and known.get(preferred, {}).get("supported") is True:
                    ordered.append(attempt)
                    attempted.add(preferred)
                    break

        for attempt in attempts:
            endpoint = attempt[0]
            endpoint_status = known.get(endpoint, {})
            if endpoint in attempted:
                continue
            if endpoint_status.get("supported") is False and endpoint_status.get("status_code") == 404:
                continue
            ordered.append(attempt)
            attempted.add(endpoint)

        return ordered

    def _describe_api_mismatch(self, attempts: list[tuple[str, dict, callable]]) -> str:
        snapshot = self._capability_snapshot()
        known = snapshot.get("endpoints", {})
        checked = [endpoint for endpoint, _, _ in attempts]
        if checked and all(known.get(endpoint, {}).get("status_code") == 404 for endpoint in checked):
            return (
                f"Ollama API mismatch at {self.base_url}: /api/tags is reachable, "
                "but all configured generation endpoints return 404 "
                f"({', '.join(checked)})."
            )
        return ""

    def generate(self, prompt: str, system: str = None, num_predict: int = 512) -> dict:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        available_models = self.list_models()
        candidate_models = self._resolve_candidate_models(available_models)

        errors = []
        for model_name in candidate_models:
            attempts = self._build_attempts(prompt, messages, system, num_predict, model_name)
            ordered_attempts = self._ordered_attempts(attempts)
            if not ordered_attempts:
                mismatch_reason = self._describe_api_mismatch(attempts)
                errors.append(mismatch_reason or f"{model_name}: all known generation endpoints are cached as unsupported")
                continue

            for endpoint, payload, extractor in ordered_attempts:
                try:
                    data = self._post(endpoint, payload)
                    text = extractor(data)
                    if not text:
                        errors.append(f"{model_name} {endpoint}: empty response")
                        continue
                    result = {
                        "text": text,
                        "model": data.get("model") or model_name,
                        "endpoint_used": endpoint,
                        "tokens": estimate_tokens(prompt + "\n" + text),
                    }
                    self._set_last_result(**result)
                    return result
                except OllamaTimeoutError:
                    raise
                except OllamaUnavailableError as exc:
                    errors.append(f"{model_name} {endpoint}: {exc}")

        self._set_last_result(endpoint_used=None, timeout=False)
        record_error()
        raise OllamaUnavailableError("All Ollama endpoints failed: " + " | ".join(errors))

    def health_check(self) -> bool:
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=self.timeout)
            response.raise_for_status()
            return True
        except requests.RequestException:
            return False

    def list_models(self) -> list[str]:
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=self.timeout)
            response.raise_for_status()
            return [item.get("name", "") for item in response.json().get("models", []) if item.get("name")]
        except requests.RequestException:
            return []
