from __future__ import annotations

import json
from pathlib import Path

RISK_REGISTER_PATH = Path("data") / "risk_register.json"

DEFAULT_RISKS = [
    {
        "id": "RISK-001",
        "category": "hallucination",
        "description": "LLM generates unsupported RCA claim.",
        "likelihood": "medium",
        "impact": "high",
        "mitigation": "Require citations, confidence scoring, and HITL review for low-confidence answers.",
        "detection_signal": "Response lacks citations or contradicts ticket evidence.",
        "fallback": "Flag for review and require human validation before action.",
        "owner": "AI Platform",
        "residual_risk": "medium",
    },
    {
        "id": "RISK-002",
        "category": "injection",
        "description": "Prompt injection via ticket content.",
        "likelihood": "medium",
        "impact": "high",
        "mitigation": "Constrain prompts to evidence-backed RCA structure and filter unsafe instructions.",
        "detection_signal": "Model output follows user-supplied instructions unrelated to RCA.",
        "fallback": "Escalate to HITL and ignore injected instructions.",
        "owner": "AI Platform",
        "residual_risk": "medium",
    },
    {
        "id": "RISK-003",
        "category": "retrieval_failure",
        "description": "Ollama unavailable in production.",
        "likelihood": "medium",
        "impact": "high",
        "mitigation": "Health checks, multi-endpoint gateway, and operational alerting.",
        "detection_signal": "Gateway cannot reach any Ollama endpoint.",
        "fallback": "Return standardized RCA_001 error response and alert operators.",
        "owner": "Platform Engineering",
        "residual_risk": "medium",
    },
    {
        "id": "RISK-004",
        "category": "cost_spike",
        "description": "Token budget exceeded causing cost spike.",
        "likelihood": "medium",
        "impact": "medium",
        "mitigation": "Record token usage and alert when daily budget is exceeded.",
        "detection_signal": "Daily token usage rises above configured budget.",
        "fallback": "Warn operators and throttle non-critical use.",
        "owner": "FinOps",
        "residual_risk": "low",
    },
    {
        "id": "RISK-005",
        "category": "data_leakage",
        "description": "Dev auth bypass left enabled in production.",
        "likelihood": "low",
        "impact": "high",
        "mitigation": "Default AUTH_BYPASS_ENABLED to false and audit user identity.",
        "detection_signal": "Audit entries show bypass-dev activity outside local development.",
        "fallback": "Disable bypass immediately and rotate access controls.",
        "owner": "Security",
        "residual_risk": "low",
    },
    {
        "id": "RISK-006",
        "category": "data_leakage",
        "description": "Retrieval returns wrong cluster's tickets.",
        "likelihood": "low",
        "impact": "high",
        "mitigation": "Always scope database ticket retrieval by cluster_id.",
        "detection_signal": "Returned citations reference unrelated clusters.",
        "fallback": "Block response and require manual review.",
        "owner": "Backend",
        "residual_risk": "low",
    },
    {
        "id": "RISK-007",
        "category": "hallucination",
        "description": "Model response treated as ground truth by user without verification.",
        "likelihood": "medium",
        "impact": "medium",
        "mitigation": "Trigger HITL banner for low confidence, missing citations, or risky instructions.",
        "detection_signal": "Low confidence score, empty citations, or high-risk keyword detection.",
        "fallback": "Escalate to manual review before execution.",
        "owner": "Product",
        "residual_risk": "medium",
    },
]


def load_risk_register() -> list[dict]:
    if not RISK_REGISTER_PATH.exists():
        return DEFAULT_RISKS
    with RISK_REGISTER_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def get_risk(risk_id: str) -> dict | None:
    for risk in load_risk_register():
        if risk.get("id") == risk_id:
            return risk
    return None
