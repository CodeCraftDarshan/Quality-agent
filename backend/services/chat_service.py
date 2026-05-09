from __future__ import annotations

from fastapi import HTTPException

from backend.agents.agent import AgentRuntimeError, RCAAgentService
from backend.utils.audit import append_audit_entry
from backend.utils.error_codes import get_error_status
from backend.services.finops import estimate_tokens, record_usage
from backend.llm.llm_gateway import get_last_gateway_result
from backend.utils.metrics import record_chat, record_error


def execute_chat_request(
    req,
    *,
    request_id: str,
    endpoint_path: str,
    user: dict,
) -> dict:
    user_id = user.get("id") or "unknown-user"
    service = RCAAgentService()

    try:
        execution = service.run(
            query=req.message,
            cluster_id=req.cluster_id,
            task_type=req.task_type,
            request_id=request_id,
        )
    except Exception as exc:
        runtime_error_code = getattr(exc, "error_code", "RCA_007")
        parse_failure = runtime_error_code == "RCA_009"
        record_error(error_code=runtime_error_code, parse_failure=parse_failure)
        append_audit_entry(
            {
                "request_id": request_id,
                "user_id": user_id,
                "endpoint": endpoint_path,
                "cluster_id": req.cluster_id,
                "task_type_requested": req.task_type,
                "task_type_resolved": None,
                "intent_resolved": None,
                "pipeline_name": None,
                "prompt_id": "rca_system_v1",
                "prompt_version": "unknown",
                "ollama_model": None,
                "ollama_endpoint_used": None,
                "mode": "error",
                "status": "error",
                "fallback_used": False,
                "fallback_reason": None,
                "parse_status": "error" if parse_failure else None,
                "retrieval_ids": [],
                "stage_timings_ms": {},
                "timing_ms": 0,
                "token_estimate": 0,
                "response_sections_present": [],
                "citations_count": 0,
                "agents_used": [],
                "verification_status": None,
                "verification_reasons": [],
                "hitl_flagged": False,
                "hitl_reasons": [],
                "error_code": runtime_error_code,
                "error": str(exc),
            }
        )
        if isinstance(exc, AgentRuntimeError):
            raise
        raise HTTPException(
            status_code=get_error_status(runtime_error_code),
            detail=getattr(exc, "message", str(exc)),
        ) from exc

    full_payload = execution.response.model_dump()
    gateway_result = get_last_gateway_result()
    tokens = int(gateway_result.get("tokens") or estimate_tokens((full_payload.get("reply") or "")))
    record_usage(
        user_id=user_id,
        tokens=tokens,
        model=full_payload.get("model", ""),
        endpoint=gateway_result.get("endpoint_used") or endpoint_path,
    )
    record_chat(
        mode=full_payload.get("mode", "ollama"),
        latency_ms=int(full_payload.get("timing_ms", 0) or 0),
        hitl_flagged=bool(full_payload.get("hitl_flagged")),
        fallback_used=bool(full_payload.get("fallback_used")),
        stage_timings_ms=full_payload.get("stage_timings_ms") or {},
    )
    append_audit_entry(
        {
            "request_id": request_id,
            "user_id": user_id,
            "endpoint": endpoint_path,
            "cluster_id": req.cluster_id,
            "task_type_requested": execution.task_type_requested,
            "task_type_resolved": execution.task_type_resolved,
            "intent_resolved": execution.intent_resolved,
            "pipeline_name": execution.pipeline_name,
            "prompt_id": execution.prompt_id,
            "prompt_version": execution.prompt_version,
            "ollama_model": full_payload.get("model"),
            "ollama_endpoint_used": execution.gateway_endpoint_used,
            "mode": full_payload.get("mode"),
            "status": execution.status,
            "fallback_used": execution.fallback_used,
            "fallback_reason": execution.fallback_reason,
            "parse_status": execution.parse_status,
            "retrieval_ids": [item.get("id") for item in full_payload.get("citations", []) if item.get("id")],
            "stage_timings_ms": execution.stage_timings_ms,
            "timing_ms": full_payload.get("timing_ms", 0),
            "token_estimate": tokens,
            "response_sections_present": [
                key
                for key in ["hypotheses", "reasoning_chain", "next_actions"]
                if full_payload.get(key)
            ],
            "citations_count": len(full_payload.get("citations", [])),
            "agents_used": list(execution.agents_used),
            "verification_status": execution.verification_result.status if execution.verification_result else None,
            "verification_reasons": list(execution.verification_result.reasons) if execution.verification_result else [],
            "hitl_flagged": bool(full_payload.get("hitl_flagged")),
            "hitl_reasons": full_payload.get("hitl_reasons", []),
            "error_code": full_payload.get("error_code"),
            "error": None,
        }
    )
    return full_payload


def execute_multi_chat_request(
    req,
    *,
    request_id: str,
    endpoint_path: str,
    user: dict,
) -> dict:
    user_id = user.get("id") or "unknown-user"
    service = RCAAgentService()

    try:
        execution = service.run_multi(
            query=req.message,
            cluster_ids=req.cluster_ids,
            task_type=req.task_type,
            request_id=request_id,
        )
    except Exception as exc:
        runtime_error_code = getattr(exc, "error_code", "RCA_007")
        parse_failure = runtime_error_code == "RCA_009"
        record_error(error_code=runtime_error_code, parse_failure=parse_failure)
        append_audit_entry(
            {
                "request_id": request_id,
                "user_id": user_id,
                "endpoint": endpoint_path,
                "cluster_id": ",".join(req.cluster_ids or []),
                "cluster_ids": list(req.cluster_ids or []),
                "task_type_requested": req.task_type,
                "task_type_resolved": None,
                "intent_resolved": None,
                "pipeline_name": None,
                "prompt_id": "rca_system_v1",
                "prompt_version": "unknown",
                "ollama_model": None,
                "ollama_endpoint_used": None,
                "mode": "error",
                "status": "error",
                "fallback_used": False,
                "fallback_reason": None,
                "parse_status": "error" if parse_failure else None,
                "retrieval_ids": [],
                "stage_timings_ms": {},
                "timing_ms": 0,
                "token_estimate": 0,
                "response_sections_present": [],
                "citations_count": 0,
                "agents_used": [],
                "verification_status": None,
                "verification_reasons": [],
                "hitl_flagged": False,
                "hitl_reasons": [],
                "error_code": runtime_error_code,
                "error": str(exc),
            }
        )
        if isinstance(exc, AgentRuntimeError):
            raise
        raise HTTPException(
            status_code=get_error_status(runtime_error_code),
            detail=getattr(exc, "message", str(exc)),
        ) from exc

    full_payload = execution.response.model_dump()
    gateway_result = get_last_gateway_result()
    tokens = int(gateway_result.get("tokens") or estimate_tokens((full_payload.get("reply") or "")))
    record_usage(
        user_id=user_id,
        tokens=tokens,
        model=full_payload.get("model", ""),
        endpoint=gateway_result.get("endpoint_used") or endpoint_path,
    )
    record_chat(
        mode=full_payload.get("mode", "ollama"),
        latency_ms=int(full_payload.get("timing_ms", 0) or 0),
        hitl_flagged=bool(full_payload.get("hitl_flagged")),
        fallback_used=bool(full_payload.get("fallback_used")),
        stage_timings_ms=full_payload.get("stage_timings_ms") or {},
    )
    append_audit_entry(
        {
            "request_id": request_id,
            "user_id": user_id,
            "endpoint": endpoint_path,
            "cluster_id": ",".join(req.cluster_ids or []),
            "cluster_ids": list(req.cluster_ids or []),
            "task_type_requested": execution.task_type_requested,
            "task_type_resolved": execution.task_type_resolved,
            "intent_resolved": execution.intent_resolved,
            "pipeline_name": execution.pipeline_name,
            "prompt_id": execution.prompt_id,
            "prompt_version": execution.prompt_version,
            "ollama_model": full_payload.get("model"),
            "ollama_endpoint_used": execution.gateway_endpoint_used,
            "mode": full_payload.get("mode"),
            "status": execution.status,
            "fallback_used": execution.fallback_used,
            "fallback_reason": execution.fallback_reason,
            "parse_status": execution.parse_status,
            "retrieval_ids": [item.get("id") for item in full_payload.get("citations", []) if item.get("id")],
            "stage_timings_ms": execution.stage_timings_ms,
            "timing_ms": full_payload.get("timing_ms", 0),
            "token_estimate": tokens,
            "response_sections_present": [
                key
                for key in ["hypotheses", "reasoning_chain", "next_actions"]
                if full_payload.get(key)
            ],
            "citations_count": len(full_payload.get("citations", [])),
            "agents_used": list(execution.agents_used),
            "verification_status": execution.verification_result.status if execution.verification_result else None,
            "verification_reasons": list(execution.verification_result.reasons) if execution.verification_result else [],
            "hitl_flagged": bool(full_payload.get("hitl_flagged")),
            "hitl_reasons": full_payload.get("hitl_reasons", []),
            "error_code": full_payload.get("error_code"),
            "error": None,
        }
    )
    return {"cluster_ids": list(req.cluster_ids or []), **full_payload}
