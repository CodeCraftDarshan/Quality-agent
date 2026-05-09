import json
import logging
import os
import re
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.agents.agent import AgentRequest, InvestigationQuestion, MultiClusterAgentRequest
from backend.agents.runtime.service import InvestigationQuestionService
from backend.auth.jwt_utils import require_role
from backend.services.chat_service import execute_chat_request, execute_multi_chat_request
from backend.core.config import CHAT_RATE_LIMIT_PER_MINUTE, OLLAMA_BASE_URL
from backend.db.models import InvestigationTicket
from backend.db.session import get_db
from backend.llm.llm_gateway import OllamaGateway, OllamaTimeoutError, OllamaUnavailableError
from backend.utils.metrics import record_chat
from backend.llm.model_router import list_available_models
from backend.prompt_registry import list_prompts
from backend.utils.audit import append_audit_entry

router = APIRouter()
logger = logging.getLogger(__name__)
_chat_requests_by_user: dict[str, list[float]] = {}
_chat_rate_lock = threading.Lock()


class InvestigationQuestionResponse(BaseModel):
    cluster_id: str
    questions: list[InvestigationQuestion]


class InvestigationQuestionsRequest(BaseModel):
    cluster_ids: list[str]
    defect_families: list[str] | None = None


def _build_multi_cluster_fallback_questions(
    cluster_ids: list[str],
    defect_families: list[str] | None,
    total_ticket_count: int,
) -> list[str]:
    cluster_summary = ", ".join(cluster_ids) or "the selected clusters"
    defect_summary = ", ".join(defect_families or []) or "the reported defects"
    primary_cluster = cluster_ids[0] if cluster_ids else "the lead cluster"
    return [
        f"What shared production or supplier signal could explain the pattern across {cluster_summary} for {defect_summary}?",
        f"Which evidence from the {total_ticket_count} available tickets would most strongly challenge the leading explanation for {primary_cluster}?",
        f"Do timing, SKU, or process-step patterns suggest one cluster is the source signal and the others are downstream effects?",
        f"Which ticket excerpts should be reviewed first to confirm whether {defect_summary} is driven by one common root cause or multiple causes?",
    ]


def _enforce_chat_rate_limit(user_id: str):
    now = time.time()
    window_start = now - 60
    with _chat_rate_lock:
        request_times = _chat_requests_by_user.get(user_id, [])
        request_times = [ts for ts in request_times if ts > window_start]
        if len(request_times) >= CHAT_RATE_LIMIT_PER_MINUTE:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Chat rate limit exceeded ({CHAT_RATE_LIMIT_PER_MINUTE}/min). "
                    "Please retry shortly."
                ),
            )
        request_times.append(now)
        _chat_requests_by_user[user_id] = request_times


def _decorate_chat_response(
    agent_response: dict,
    response: Response,
    mode: str,
    latency_ms: int,
) -> dict:
    response.headers["X-Copilot-Mode"] = mode
    response.headers["X-Copilot-Latency-Ms"] = str(latency_ms)
    return agent_response


def _run_chat_request(
    req: AgentRequest,
    request: Request,
    response: Response,
    user: dict,
) -> dict:
    user_id = user.get("id") or "unknown-user"
    _enforce_chat_rate_limit(user_id)
    full_payload = execute_chat_request(
        req,
        request_id=getattr(request.state, "request_id", ""),
        endpoint_path=request.url.path,
        user=user,
    )
    return _decorate_chat_response(
        full_payload,
        response,
        mode=full_payload.get("mode", "ollama"),
        latency_ms=int(full_payload.get("timing_ms", 0) or 0),
    )


def _run_multi_chat_request(
    req: MultiClusterAgentRequest,
    request: Request,
    response: Response,
    user: dict,
) -> dict:
    user_id = user.get("id") or "unknown-user"
    _enforce_chat_rate_limit(user_id)
    full_payload = execute_multi_chat_request(
        req,
        request_id=getattr(request.state, "request_id", ""),
        endpoint_path=request.url.path,
        user=user,
    )
    return _decorate_chat_response(
        full_payload,
        response,
        mode=full_payload.get("mode", "ollama"),
        latency_ms=int(full_payload.get("timing_ms", 0) or 0),
    )


@router.post("/api/chat")
def chat_endpoint(
    req: AgentRequest,
    request: Request,
    response: Response,
    user: dict = Depends(require_role("admin", "moderator")),
):
    return _run_chat_request(req, request, response, user)


@router.post("/api/chat/multi")
def chat_multi_endpoint(
    req: MultiClusterAgentRequest,
    request: Request,
    response: Response,
    user: dict = Depends(require_role("admin", "moderator")),
):
    return _run_multi_chat_request(req, request, response, user)


@router.post("/api/chat-ollama")
def chat_ollama_endpoint(
    req: AgentRequest,
    request: Request,
    response: Response,
    user: dict = Depends(require_role("admin", "moderator")),
):
    return _run_chat_request(req, request, response, user)


@router.post("/api/v2/chat")
def chat_v2_endpoint(
    req: AgentRequest,
    request: Request,
    response: Response,
    user: dict = Depends(require_role("admin", "moderator")),
):
    return _run_chat_request(req, request, response, user)


@router.get("/api/investigation-questions", response_model=InvestigationQuestionResponse)
def investigation_questions_endpoint(
    request: Request,
    cluster_id: str,
    count: int = 4,
    user: dict = Depends(require_role("admin", "moderator")),
):
    trace = InvestigationQuestionService().generate_with_trace(cluster_id=cluster_id, question_count=count)
    record_chat(
        mode="question-generation",
        latency_ms=sum(trace["stage_timings_ms"].values()),
        hitl_flagged=False,
        fallback_used=trace["fallback_used"],
        stage_timings_ms=trace["stage_timings_ms"],
    )
    append_audit_entry(
        {
            "request_id": getattr(request.state, "request_id", "") if request else "",
            "user_id": user.get("id") or "unknown-user",
            "endpoint": "/api/investigation-questions",
            "cluster_id": cluster_id,
            "task_type_requested": "rca",
            "task_type_resolved": "rca",
            "intent_resolved": "full",
            "pipeline_name": trace["pipeline_name"],
            "prompt_id": trace["prompt_id"],
            "prompt_version": trace["prompt_version"],
            "ollama_model": None,
            "ollama_endpoint_used": None,
            "mode": "question-generation",
            "status": "success",
            "fallback_used": trace["fallback_used"],
            "fallback_reason": trace["fallback_reason"],
            "parse_status": "question_list",
            "retrieval_ids": [],
            "stage_timings_ms": trace["stage_timings_ms"],
            "timing_ms": sum(trace["stage_timings_ms"].values()),
            "token_estimate": 0,
            "response_sections_present": ["questions"],
            "citations_count": 0,
            "hitl_flagged": False,
            "hitl_reasons": [],
            "error_code": None,
            "error": None,
        }
    )
    return {"cluster_id": cluster_id, "questions": trace["questions"]}


@router.post("/api/investigate/questions")
def generate_investigation_questions_for_clusters(
    body: InvestigationQuestionsRequest,
    _: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    if not body.cluster_ids:
        return {"questions": []}

    cluster_summary = ", ".join(body.cluster_ids)
    defect_summary = ", ".join(body.defect_families) if body.defect_families else "unknown defects"
    total_ticket_count = sum(
        db.query(InvestigationTicket)
        .filter(InvestigationTicket.cluster_id == cluster_id)
        .count()
        for cluster_id in body.cluster_ids
    )
    fallback_questions = _build_multi_cluster_fallback_questions(
        cluster_ids=body.cluster_ids,
        defect_families=body.defect_families,
        total_ticket_count=total_ticket_count,
    )

    prompt = f"""
You are investigating quality complaint clusters: {cluster_summary}
Defect families involved: {defect_summary}
You have access to {total_ticket_count} real tickets across clusters {cluster_summary}.
Generate questions that can be answered using this data.
Do not generate questions about data that does not exist
(e.g. do not ask about batch numbers unless batch numbers
appear in the defect families or cluster metadata provided).

Generate exactly 4 short investigative questions that challenge
assumptions and uncover root causes across these clusters.
Questions must:
- Be specific to the defect families listed
- Challenge timing, supplier, process, or batch angles
- Look for cross-cluster patterns
- Be answerable with ticket and cluster evidence

Return ONLY a valid JSON array of exactly 4 question strings.
No explanation. No markdown. Example:
["Question 1?", "Question 2?", "Question 3?", "Question 4?"]
"""

    try:
        gateway = OllamaGateway(
            base_url=OLLAMA_BASE_URL,
            model=os.getenv("OLLAMA_MODEL_HYPOTHESIS", "auraqc-hypothesis"),
            timeout=30,
            fallback_model=os.getenv("OLLAMA_MODEL_FALLBACK", "auraqc-fallback"),
        )
        result = gateway.generate(prompt=prompt, num_predict=256)
        text = result["text"].strip()
        match = re.search(r"\[.*?\]", text, re.DOTALL)
        if match:
            questions = json.loads(match.group())
            if isinstance(questions, list):
                normalized = [str(question).strip() for question in questions if str(question).strip()]
                if normalized:
                    return {"questions": normalized[:4]}
        logger.warning("Question generation returned unparsable output; using deterministic fallback questions.")
        return {"questions": fallback_questions}
    except (OllamaUnavailableError, OllamaTimeoutError) as exc:
        logger.warning("Ollama unavailable for investigation questions; using deterministic fallback. Reason: %s", exc)
        return {"questions": fallback_questions}
    except Exception as exc:
        logger.error("Unexpected question generation failure; using deterministic fallback: %s", exc)
        return {"questions": fallback_questions}


@router.get("/api/prompts")
def prompts_endpoint(_: dict = Depends(require_role("admin", "moderator"))):
    return list_prompts()


@router.get("/api/models")
def models_endpoint(_: dict = Depends(require_role("admin", "moderator"))):
    return {"task_models": list_available_models()}
