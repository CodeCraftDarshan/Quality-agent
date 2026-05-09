from __future__ import annotations

import logging
import os
import time
import uuid

from backend.confidence import compute_confidence
from backend.env_loader import load_backend_env
from backend.hitl import should_flag_for_hitl
from backend.llm.llm_gateway import OllamaGateway, OllamaTimeoutError, OllamaUnavailableError
from backend.llm.model_router import DEFAULT_TASK_TYPE, get_model_for_task, is_valid_task_type
from backend.prompt_registry import PROMPTS, get_intent_instruction, render_prompt

from backend.agents.runtime.contracts import AgentExecutionResult, AgentResponse, InvestigationQuestion
from backend.agents.runtime.intents import detect_intent, filter_response_by_intent, resolve_intent
from backend.agents.runtime.parsing import (
    build_local_analysis_bundle,
    build_local_analysis_bundle_multi,
    parse_agent_reply,
    parse_investigation_questions,
)
from backend.agents.runtime.pipeline import get_investigation_question_plan, get_rca_execution_plan
from backend.agents.runtime.registry import AgentRegistry
from backend.agents.runtime.repository import AgentRepository

load_backend_env()

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_FALLBACK_MODEL = os.getenv("OLLAMA_FALLBACK_MODEL", "auraqc-fallback")
OLLAMA_TIMEOUT_SEC = max(5, int(os.getenv("OLLAMA_TIMEOUT_SEC", "60")))
OLLAMA_NUM_PREDICT = max(64, int(os.getenv("OLLAMA_NUM_PREDICT", "512")))
PROMPT_VERSION_LOOKUP = {prompt["id"]: prompt["version"] for prompt in PROMPTS}

TASK_INTENT_COMPATIBILITY = {
    "rca": {"full", "summary", "reasoning", "actions", "hypothesis", "citations", "challenge"},
    "hypothesis": {"hypothesis", "summary", "full"},
    "challenge": {"challenge", "summary", "full"},
    "citations": {"citations", "reasoning", "summary", "full"},
}


class OllamaConnectionError(RuntimeError):
    """Compatibility exception expected by the API layer."""


class AgentRuntimeError(RuntimeError):
    def __init__(self, error_code: str, message: str, status_code: int):
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


class InvalidTaskTypeError(AgentRuntimeError):
    def __init__(self, task_type: str):
        super().__init__("RCA_008", f"Invalid task_type '{task_type}'", 422)


class InvalidTaskIntentCombinationError(AgentRuntimeError):
    def __init__(self, task_type: str, intent: str):
        super().__init__("RCA_012", f"task_type '{task_type}' conflicts with detected intent '{intent}'", 422)


class AgentContextLoadError(AgentRuntimeError):
    def __init__(self, cluster_id: str):
        super().__init__("RCA_006", f"Cluster '{cluster_id}' not found", 404)


class AgentParseError(AgentRuntimeError):
    def __init__(self, message: str = "Model response parsing failed"):
        super().__init__("RCA_009", message, 502)


class AgentPostProcessingError(AgentRuntimeError):
    def __init__(self, message: str = "Response post-processing failed"):
        super().__init__("RCA_010", message, 500)


def _trim_text(value: object, limit: int = 320) -> str:
    text = " ".join(str(value or "").split()).strip()
    if limit <= 0 or len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def _refine_overcautious_reply(summary: str, query: str, context) -> str:
    text = str(summary or "").strip()
    lowered = text.lower()
    if not lowered.startswith("insufficient data to determine"):
        return text

    cluster = getattr(context, "cluster", None)
    tickets = tuple(getattr(context, "tickets", ()) or ())
    if not cluster and not tickets:
        return text

    shared_skus = sorted(
        {
            str(ticket.associated_sku).strip()
            for ticket in tickets
            if getattr(ticket, "associated_sku", None)
        }
    )
    if not shared_skus and getattr(cluster, "sku", None):
        shared_skus = [str(cluster.sku).strip()]

    ticket_ids = [ticket.ticket_id for ticket in tickets[:3] if getattr(ticket, "ticket_id", None)]
    observations: list[str] = []
    if shared_skus:
        observations.append(f"the available tickets all reference SKU {', '.join(shared_skus)}")
    if getattr(cluster, "ai_summary", None):
        observations.append(f"the cluster summary says {str(cluster.ai_summary).rstrip('.').lower()}")
    if ticket_ids:
        observations.append(f"the visible complaint set includes {', '.join(ticket_ids)}")

    if not observations:
        return text

    query_lower = str(query or "").lower()
    if any(keyword in query_lower for keyword in ("supplier batch", "same batch", "batch", "lot", "supplier")):
        missing_field = "ticket-level supplier batch or lot identifiers are not present in the current evidence"
    else:
        missing_field = "the current evidence does not include the exact field needed to fully confirm that conclusion"

    answer = (
        f"Available evidence shows {', '.join(observations)}, but {missing_field}, "
        f"so the exact point in your question cannot be confirmed from this cluster alone. "
        "[DB-CLUSTER] [DB-TICKETS]"
    )
    return _trim_text(answer, limit=320)


def _stage_timer(stage_timings: dict[str, int], stage_name: str, started_at: float) -> None:
    stage_timings[stage_name] = max(0, int((time.time() - started_at) * 1000))


def _resolve_task_type(query: str, task_type: str | None) -> tuple[str, str]:
    requested = str(task_type or "").strip().lower() or None
    detected_intent = detect_intent(query)
    if requested is None:
        return DEFAULT_TASK_TYPE, detected_intent
    if not is_valid_task_type(requested):
        raise InvalidTaskTypeError(requested)
    allowed_intents = TASK_INTENT_COMPATIBILITY.get(requested, {detected_intent})
    if detected_intent not in allowed_intents:
        raise InvalidTaskIntentCombinationError(requested, detected_intent)
    return requested, detected_intent


class RCAAgentService:
    def __init__(self, repository: AgentRepository | None = None):
        self.repository = repository or AgentRepository()
        self.execution_plan = get_rca_execution_plan()
        self.registry = AgentRegistry()

    def run(self, query: str, cluster_id: str, task_type: str | None = None, request_id: str | None = None) -> AgentExecutionResult:
        context_started_at = time.time()
        try:
            context = self.repository.load_cluster_context(cluster_id)
        except ValueError as exc:
            raise AgentContextLoadError(cluster_id) from exc
        return self._run_with_context(
            query=query,
            context=context,
            task_type=task_type,
            request_id=request_id,
            cluster_id=cluster_id,
            multi_cluster_ids=(cluster_id,),
            context_started_at=context_started_at,
        )

    def run_multi(
        self,
        query: str,
        cluster_ids: list[str],
        task_type: str | None = None,
        request_id: str | None = None,
    ) -> AgentExecutionResult:
        context_started_at = time.time()
        try:
            context = self.repository.load_multi_cluster_context(cluster_ids)
        except ValueError as exc:
            missing_cluster = cluster_ids[0] if cluster_ids else ""
            raise AgentContextLoadError(missing_cluster) from exc
        return self._run_with_context(
            query=query,
            context=context,
            task_type=task_type,
            request_id=request_id,
            cluster_id=", ".join(context.cluster_ids),
            multi_cluster_ids=context.cluster_ids,
            context_started_at=context_started_at,
        )

    def _run_with_context(
        self,
        *,
        query: str,
        context,
        task_type: str | None,
        request_id: str | None,
        cluster_id: str,
        multi_cluster_ids: tuple[str, ...],
        context_started_at: float,
    ) -> AgentExecutionResult:
        request_id = request_id or str(uuid.uuid4())
        started_at = time.time()
        stage_timings: dict[str, int] = {}
        parse_status = "structured"
        fallback_used = False
        fallback_reason: str | None = None
        gateway_endpoint_used: str | None = None

        normalized_task_type, detected_intent = _resolve_task_type(query, task_type)
        intent = resolve_intent(query, normalized_task_type)
        selected_model = get_model_for_task(normalized_task_type)
        orchestrator = self.registry.get("orchestrator")
        route = orchestrator.plan_route(intent)
        agents_used = tuple(agent_name.value for agent_name in route.agents)
        logger.info(
            "Routing RCA request through orchestrator",
            extra={
                "request_id": request_id,
                "cluster_id": cluster_id,
                "pipeline_name": self.execution_plan.name,
                "agent_name": "orchestrator",
                "model": selected_model,
            },
        )

        _stage_timer(stage_timings, "load_context", context_started_at)
        evidence_packet = self.registry.get("evidence").collect(context)

        prompt_started_at = time.time()
        prompt = render_prompt(
            "rca_system_v1",
            {
                "db_context": context.db_context,
                "ticket_context": context.ticket_context,
                "query": query,
                "intent_instruction": get_intent_instruction(intent),
            },
        )
        if len(multi_cluster_ids) > 1:
            total_ticket_count = len(context.tickets)
            if total_ticket_count > 0:
                prompt = (
                    f"{prompt}\n\n"
                    f"NOTE: You have {total_ticket_count} tickets across {len(context.clusters)} clusters. "
                    f"This is sufficient data. Do NOT say 'insufficient data'. "
                    f"Extract patterns from the ticket evidence provided above.\n\n"
                    "CROSS-CLUSTER ANALYSIS RULES:\n"
                    "- Cite specific ticket IDs from the evidence above\n"
                    "- Compare patterns BETWEEN clusters explicitly\n"
                    "- If two clusters share a defect pattern, name both cluster IDs and the ticket IDs that show it\n"
                    "- Do not make general statements. Every claim needs a ticket ID or cluster ID as evidence\n"
                    "- Batch numbers, lot codes, supplier names, shift times found in tickets MUST be referenced if present\n"
                    "- If a pattern only exists in one cluster, say so explicitly\n"
                )
        contribution_fragments: list[str] = []
        for agent_name in route.agents:
            if agent_name.value in {"hypothesis", "challenge", "action_plan"}:
                contribution = self.registry.get(agent_name).contribute(evidence_packet, query)
                contribution_fragments.append(contribution.prompt_fragment.strip())
        if contribution_fragments:
            prompt = f"{prompt}\n\nAGENT COLLABORATION PLAN:\n" + "\n\n".join(contribution_fragments)
        _stage_timer(stage_timings, "build_prompt", prompt_started_at)

        generation_started_at = time.time()
        try:
            gateway = OllamaGateway(
                base_url=OLLAMA_BASE_URL,
                model=selected_model,
                timeout=OLLAMA_TIMEOUT_SEC,
                fallback_model=OLLAMA_FALLBACK_MODEL,
            )
            result = gateway.generate(prompt=prompt, num_predict=OLLAMA_NUM_PREDICT)
            gateway_endpoint_used = result.get("endpoint_used")
        except (OllamaUnavailableError, OllamaTimeoutError) as exc:
            fallback_used = True
            fallback_reason = str(exc)
            result = None
        _stage_timer(stage_timings, "generate", generation_started_at)

        parse_started_at = time.time()
        if result:
            parsed = parse_agent_reply(query=query, reply_text=result.get("text", ""), known_citations=context.citations)
            has_structured_support = bool(
                parsed.hypotheses or parsed.reasoning_chain or parsed.next_actions or parsed.anti_gravity_challenge
            )
            parse_status = "structured" if has_structured_support else "summary_only"
            if not parsed.summary:
                raise AgentParseError()
            refined_reply = _refine_overcautious_reply(parsed.summary, query, context)
            response = AgentResponse(
                reply=refined_reply,
                citations=list(parsed.citations),
                hypotheses=list(parsed.hypotheses),
                reasoning_chain=list(parsed.reasoning_chain),
                anti_gravity_challenge=parsed.anti_gravity_challenge,
                next_actions=list(parsed.next_actions),
                model=result.get("model") or selected_model,
                mode="ollama",
                timing_ms=0,
                pipeline_name=self.execution_plan.name,
                fallback_used=False,
                stage_timings_ms={},
                task_type_resolved=normalized_task_type,
            )
        else:
            parse_status = "fallback_local_analysis"
            if len(multi_cluster_ids) > 1:
                bundle = build_local_analysis_bundle_multi(query, context.clusters, context.tickets, context.citations)
            else:
                bundle = build_local_analysis_bundle(query, context.cluster, context.tickets, context.citations)
            response = AgentResponse(
                reply=bundle.direct_answer,
                citations=list(bundle.citations),
                hypotheses=list(bundle.hypotheses),
                reasoning_chain=list(bundle.reasoning_chain),
                anti_gravity_challenge=bundle.anti_gravity_challenge,
                next_actions=list(bundle.next_actions),
                model="intelligent-local-analysis",
                mode="local-analysis",
                timing_ms=0,
                pipeline_name=self.execution_plan.name,
                fallback_used=True,
                stage_timings_ms={},
                task_type_resolved=normalized_task_type,
            )
        _stage_timer(stage_timings, "parse_response", parse_started_at)

        fallback_stage_started_at = time.time()
        _stage_timer(stage_timings, "apply_fallback", fallback_stage_started_at)

        post_process_started_at = time.time()
        try:
            response = filter_response_by_intent(response, intent)
            payload = response.model_dump()
            response.confidence = compute_confidence(payload, list(context.citations))
            response.hitl_flagged, response.hitl_reasons = should_flag_for_hitl({**payload, "confidence": response.confidence})
            verification_result = self.registry.get("verifier").verify(
                {
                    **response.model_dump(),
                    "confidence": response.confidence,
                }
            )
        except Exception as exc:
            raise AgentPostProcessingError(str(exc)) from exc
        _stage_timer(stage_timings, "post_process", post_process_started_at)

        response.timing_ms = max(0, int((time.time() - started_at) * 1000))
        response.pipeline_name = self.execution_plan.name
        response.fallback_used = fallback_used
        response.stage_timings_ms = stage_timings
        response.task_type_resolved = normalized_task_type
        logger.info(
            "Completed RCA execution",
            extra={
                "request_id": request_id,
                "cluster_id": cluster_id,
                "pipeline_name": self.execution_plan.name,
                "agent_name": "verifier",
                "model": response.model,
                "fallback_used": fallback_used,
                "timing_ms": response.timing_ms,
            },
        )

        return AgentExecutionResult(
            response=response,
            request_id=request_id,
            cluster_id=cluster_id,
            task_type_requested=task_type,
            task_type_resolved=normalized_task_type,
            intent_resolved=intent,
            pipeline_name=self.execution_plan.name,
            prompt_id="rca_system_v1",
            prompt_version=PROMPT_VERSION_LOOKUP.get("rca_system_v1", "unknown"),
            selected_model=response.model,
            gateway_endpoint_used=gateway_endpoint_used,
            stage_timings_ms=stage_timings,
            fallback_used=fallback_used,
            fallback_reason=fallback_reason,
            parse_status=parse_status,
            status="success",
            route=route,
            verification_result=verification_result,
            agents_used=agents_used,
        )


class InvestigationQuestionService:
    def __init__(self, repository: AgentRepository | None = None):
        self.repository = repository or AgentRepository()
        self.execution_plan = get_investigation_question_plan()

    def generate(self, cluster_id: str, question_count: int = 4) -> list[InvestigationQuestion]:
        return self.generate_with_trace(cluster_id=cluster_id, question_count=question_count)["questions"]

    def generate_with_trace(self, cluster_id: str, question_count: int = 4) -> dict:
        stage_timings: dict[str, int] = {}
        fallback_used = False
        fallback_reason = None

        context_started_at = time.time()
        try:
            context = self.repository.load_cluster_context(cluster_id, ticket_limit=4)
        except ValueError as exc:
            raise AgentContextLoadError(cluster_id) from exc
        _stage_timer(stage_timings, "load_context", context_started_at)

        question_count = max(2, min(question_count, 6))
        prompt_started_at = time.time()
        prompt = render_prompt(
            "investigation_questions_v1",
            {
                "db_context": context.db_context,
                "ticket_context": context.ticket_context,
                "question_count": question_count,
            },
        )
        _stage_timer(stage_timings, "build_prompt", prompt_started_at)

        generation_started_at = time.time()
        raw_text = ""
        try:
            gateway = OllamaGateway(
                base_url=OLLAMA_BASE_URL,
                model=get_model_for_task("rca"),
                timeout=OLLAMA_TIMEOUT_SEC,
                fallback_model=OLLAMA_FALLBACK_MODEL,
            )
            result = gateway.generate(prompt=prompt, num_predict=min(OLLAMA_NUM_PREDICT, 320))
            raw_text = result.get("text", "")
        except (OllamaUnavailableError, OllamaTimeoutError) as exc:
            fallback_used = True
            fallback_reason = str(exc)
        _stage_timer(stage_timings, "generate", generation_started_at)

        parse_started_at = time.time()
        parsed = parse_investigation_questions(raw_text, question_count) if raw_text else []
        _stage_timer(stage_timings, "parse_response", parse_started_at)

        fallback_started_at = time.time()
        cluster = context.cluster
        fallback_questions = [
            InvestigationQuestion(
                text=f"What specific production-stage signal best explains the recurring {cluster.defect_family or 'defect'} pattern in {cluster.cluster_id}?",
                task_type="rca",
            ),
            InvestigationQuestion(
                text=f"What counter-evidence would disprove the current leading explanation for cluster {cluster.cluster_id}?",
                task_type="challenge",
            ),
            InvestigationQuestion(
                text=f"Which evidence most strongly supports an alternate hypothesis for SKU {cluster.sku or cluster.cluster_id}?",
                task_type="hypothesis",
            ),
            InvestigationQuestion(
                text=f"Which ticket excerpts should be reviewed first to verify the defect signal in cluster {cluster.cluster_id}?",
                task_type="citations",
            ),
        ]
        for fallback in fallback_questions:
            if len(parsed) >= question_count:
                break
            if all(existing.text.lower() != fallback.text.lower() for existing in parsed):
                parsed.append(fallback)
                fallback_used = True
                fallback_reason = fallback_reason or "Generated fallback investigation questions"
        _stage_timer(stage_timings, "apply_fallback", fallback_started_at)

        return {
            "questions": parsed[:question_count],
            "pipeline_name": self.execution_plan.name,
            "fallback_used": fallback_used,
            "fallback_reason": fallback_reason,
            "stage_timings_ms": stage_timings,
            "prompt_id": "investigation_questions_v1",
            "prompt_version": PROMPT_VERSION_LOOKUP.get("investigation_questions_v1", "unknown"),
        }


def run_agentic_rca(query: str, cluster_id: str, task_type: str | None = None) -> AgentResponse:
    return RCAAgentService().run(query=query, cluster_id=cluster_id, task_type=task_type).response


def run_agentic_rca_v2(query: str, cluster_id: str) -> AgentResponse:
    return run_agentic_rca(query, cluster_id)


def generate_investigation_questions(cluster_id: str, question_count: int = 4) -> list[InvestigationQuestion]:
    return InvestigationQuestionService().generate(cluster_id=cluster_id, question_count=question_count)
