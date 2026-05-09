from __future__ import annotations

from backend.agents.runtime.contracts import AgentIntent, AgentResponse, TaskType

ALWAYS_KEEP = {
    "reply",
    "mode",
    "model",
    "timing_ms",
    "request_id",
    "confidence",
    "hitl_flagged",
    "hitl_reasons",
    "citations",
}

INTENT_FIELDS = {
    AgentIntent.HYPOTHESIS.value: {"hypotheses"},
    AgentIntent.CHALLENGE.value: {"anti_gravity_challenge", "reasoning_chain"},
    AgentIntent.REASONING.value: {"reasoning_chain"},
    AgentIntent.ACTIONS.value: {"next_actions"},
    AgentIntent.CITATIONS.value: {"reasoning_chain"},
    AgentIntent.SUMMARY.value: set(),
    AgentIntent.FULL.value: {"hypotheses", "reasoning_chain", "anti_gravity_challenge", "next_actions"},
}

TASK_TYPE_TO_INTENT = {
    TaskType.RCA.value: AgentIntent.FULL.value,
    TaskType.HYPOTHESIS.value: AgentIntent.HYPOTHESIS.value,
    TaskType.CHALLENGE.value: AgentIntent.CHALLENGE.value,
    TaskType.CITATIONS.value: AgentIntent.CITATIONS.value,
}


def detect_intent(query: str) -> str:
    q = (query or "").lower()
    if any(kw in q for kw in ["hypothesis", "hypothes", "cause", "why"]):
        return AgentIntent.HYPOTHESIS.value
    if any(kw in q for kw in ["reason", "explain", "how did", "chain"]):
        return AgentIntent.REASONING.value
    if any(kw in q for kw in ["action", "do next", "fix", "resolve", "what should"]):
        return AgentIntent.ACTIONS.value
    if any(kw in q for kw in ["summary", "summarize", "brief", "tldr", "overview"]):
        return AgentIntent.SUMMARY.value
    return AgentIntent.FULL.value


def resolve_intent(query: str, task_type: str | None = None) -> str:
    normalized_task = str(task_type or "").strip().lower()
    if normalized_task in TASK_TYPE_TO_INTENT:
        return TASK_TYPE_TO_INTENT[normalized_task]
    return detect_intent(query)


def filter_response_by_intent(response: AgentResponse, intent: str) -> AgentResponse:
    allowed = ALWAYS_KEEP | INTENT_FIELDS.get(intent, INTENT_FIELDS[AgentIntent.FULL.value])
    if "hypotheses" not in allowed:
        response.hypotheses = []
    if "reasoning_chain" not in allowed:
        response.reasoning_chain = []
    if "anti_gravity_challenge" not in allowed:
        response.anti_gravity_challenge = None
    if "next_actions" not in allowed:
        response.next_actions = []
    if "reply" not in allowed:
        response.reply = ""
    response.intent = intent
    return response


def project_response_by_intent(payload: dict, query: str) -> dict:
    intent = detect_intent(query)
    keep = ALWAYS_KEEP | INTENT_FIELDS.get(intent, INTENT_FIELDS[AgentIntent.FULL.value])
    projected = {k: v for k, v in payload.items() if k in keep}
    projected["intent"] = intent
    return projected
