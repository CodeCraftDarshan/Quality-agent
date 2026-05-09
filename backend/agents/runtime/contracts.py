from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum

from pydantic import BaseModel, Field


class AgentIntent(str, Enum):
    HYPOTHESIS = "hypothesis"
    CHALLENGE = "challenge"
    REASONING = "reasoning"
    ACTIONS = "actions"
    CITATIONS = "citations"
    SUMMARY = "summary"
    FULL = "full"


class TaskType(str, Enum):
    RCA = "rca"
    HYPOTHESIS = "hypothesis"
    CHALLENGE = "challenge"
    CITATIONS = "citations"


class AgentName(str, Enum):
    ORCHESTRATOR = "orchestrator"
    EVIDENCE = "evidence"
    HYPOTHESIS = "hypothesis"
    CHALLENGE = "challenge"
    ACTION_PLAN = "action_plan"
    VERIFIER = "verifier"


class PipelineStage(str, Enum):
    LOAD_CONTEXT = "load_context"
    BUILD_PROMPT = "build_prompt"
    GENERATE = "generate"
    PARSE_RESPONSE = "parse_response"
    APPLY_FALLBACK = "apply_fallback"
    POST_PROCESS = "post_process"


@dataclass(frozen=True)
class PipelineStep:
    stage: PipelineStage
    owner: str
    description: str
    parallelizable: bool = False


@dataclass(frozen=True)
class PipelineExecutionPlan:
    name: str
    steps: tuple[PipelineStep, ...]


class Citation(BaseModel):
    id: str
    source: str
    excerpt: str = ""


class AgentRequest(BaseModel):
    message: str
    cluster_id: str
    task_type: str | None = None


class MultiClusterAgentRequest(BaseModel):
    message: str
    cluster_ids: list[str]
    task_type: str | None = None


class Hypothesis(BaseModel):
    title: str
    confidence: float | None = None


class AgentResponse(BaseModel):
    reply: str
    citations: list[Citation] = Field(default_factory=list)
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    reasoning_chain: list[str] = Field(default_factory=list)
    anti_gravity_challenge: str | None = None
    next_actions: list[str] = Field(default_factory=list)
    model: str
    mode: str = "ollama"
    timing_ms: int
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    intent: str = AgentIntent.FULL.value
    confidence: float = 0.0
    hitl_flagged: bool = False
    hitl_reasons: list[str] = Field(default_factory=list)
    error_code: str | None = None
    pipeline_name: str | None = None
    fallback_used: bool = False
    stage_timings_ms: dict[str, int] = Field(default_factory=dict)
    task_type_resolved: str | None = None


class InvestigationQuestion(BaseModel):
    text: str
    task_type: str = TaskType.RCA.value


@dataclass(frozen=True)
class ClusterSnapshot:
    cluster_id: str
    title: str | None
    sku: str | None
    defect_family: str | None
    count: int
    confidence: float | None
    severity: str | None
    ai_summary: str | None


@dataclass(frozen=True)
class TicketSnapshot:
    ticket_id: str
    timestamp: str | None
    content: str | None
    severity: str | None
    associated_sku: str | None


@dataclass(frozen=True)
class AgentContext:
    cluster: ClusterSnapshot
    tickets: tuple[TicketSnapshot, ...]
    citations: tuple[dict[str, str], ...]
    db_context: str
    ticket_context: str


@dataclass(frozen=True)
class MultiClusterContext:
    cluster: ClusterSnapshot
    clusters: tuple[ClusterSnapshot, ...]
    tickets: tuple[TicketSnapshot, ...]
    citations: tuple[dict[str, str], ...]
    db_context: str
    ticket_context: str
    cluster_ids: tuple[str, ...]


@dataclass(frozen=True)
class EvidencePacket:
    cluster_id: str
    summary: str
    db_context: str
    ticket_context: str
    citations: tuple[dict[str, str], ...]
    top_ticket_ids: tuple[str, ...]
    signals: tuple[str, ...]


@dataclass(frozen=True)
class ParsedReply:
    summary: str
    hypotheses: tuple[Hypothesis, ...] = ()
    reasoning_chain: tuple[str, ...] = ()
    anti_gravity_challenge: str | None = None
    next_actions: tuple[str, ...] = ()
    citations: tuple[Citation, ...] = ()
    raw_reply: str = ""


@dataclass(frozen=True)
class LocalAnalysisBundle:
    direct_answer: str
    hypotheses: tuple[Hypothesis, ...]
    reasoning_chain: tuple[str, ...]
    anti_gravity_challenge: str | None
    next_actions: tuple[str, ...]
    citations: tuple[Citation, ...]


@dataclass
class StageTrace:
    timings_ms: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentContribution:
    agent_name: AgentName
    prompt_fragment: str
    reasoning_focus: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentRoute:
    intent: str
    agents: tuple[AgentName, ...]


@dataclass(frozen=True)
class VerificationResult:
    verified: bool
    status: str
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class PipelineTrace:
    pipeline_name: str
    route: AgentRoute
    agents_used: tuple[str, ...]
    stage_timings_ms: dict[str, int]


@dataclass(frozen=True)
class AgentExecutionResult:
    response: AgentResponse
    request_id: str
    cluster_id: str
    task_type_requested: str | None
    task_type_resolved: str
    intent_resolved: str
    pipeline_name: str
    prompt_id: str
    prompt_version: str
    selected_model: str
    gateway_endpoint_used: str | None
    stage_timings_ms: dict[str, int]
    fallback_used: bool
    fallback_reason: str | None
    parse_status: str
    status: str
    route: AgentRoute | None = None
    verification_result: VerificationResult | None = None
    agents_used: tuple[str, ...] = ()
    error_code: str | None = None
    error_message: str | None = None
