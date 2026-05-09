from __future__ import annotations

from copy import deepcopy

METRICS = {
    "chat_requests_total": 0,
    "chat_requests_ollama": 0,
    "chat_errors_total": 0,
    "agent_runtime_errors_total": 0,
    "hitl_flags_total": 0,
    "chat_fallback_total": 0,
    "parse_failures_total": 0,
    "avg_latency_ms": 0.0,
    "tokens_used_today": 0,
    "last_error_code": None,
    "stage_latency_ms_avg": {},
}

_latency_samples = 0


def record_chat(
    mode: str,
    latency_ms: int,
    hitl_flagged: bool = False,
    fallback_used: bool = False,
    stage_timings_ms: dict[str, int] | None = None,
) -> None:
    global _latency_samples
    METRICS["chat_requests_total"] += 1
    if mode == "ollama":
        METRICS["chat_requests_ollama"] += 1
    if hitl_flagged:
        METRICS["hitl_flags_total"] += 1
    if fallback_used:
        METRICS["chat_fallback_total"] += 1

    _latency_samples += 1
    previous = METRICS["avg_latency_ms"]
    METRICS["avg_latency_ms"] = round(previous + ((max(latency_ms, 0) - previous) / _latency_samples), 2)
    record_stage_timings(stage_timings_ms or {})


def record_error(error_code: str | None = None, parse_failure: bool = False) -> None:
    METRICS["chat_errors_total"] += 1
    METRICS["agent_runtime_errors_total"] += 1
    METRICS["last_error_code"] = error_code
    if parse_failure:
        METRICS["parse_failures_total"] += 1


def record_tokens(tokens: int) -> None:
    METRICS["tokens_used_today"] += max(0, int(tokens))


def record_stage_timings(stage_timings_ms: dict[str, int]) -> None:
    for stage_name, latency in (stage_timings_ms or {}).items():
        key = str(stage_name)
        average_key = f"{key}_avg"
        stage_metrics = METRICS["stage_latency_ms_avg"]
        sample_key = f"{key}_samples"
        previous = float(stage_metrics.get(average_key, 0.0) or 0.0)
        samples = int(stage_metrics.get(sample_key, 0) or 0) + 1
        stage_metrics[sample_key] = samples
        stage_metrics[average_key] = round(previous + ((max(int(latency), 0) - previous) / samples), 2)


def snapshot_metrics() -> dict:
    return deepcopy(METRICS)
