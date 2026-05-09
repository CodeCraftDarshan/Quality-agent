from __future__ import annotations
from copy import deepcopy

# ── Intent instructions injected into prompt based on user query ──
INTENT_INSTRUCTIONS = {
    "hypothesis": (
        "The user wants a hypothesis-focused answer to the exact question they asked. "
        "First answer that question directly in 'Conclusion'. "
        "Then return only the 'Hypotheses' section if hypotheses are supported by the evidence. "
        "Do not include generic RCA filler, broad action lists, or unrelated sections."
    ),
    "challenge": (
        "The user wants a counter-hypothesis / reverse-causality challenge to the exact question they asked. "
        "First answer the question directly in 'Conclusion'. "
        "Then return ONLY the 'Anti-Gravity Challenge' and 'Reasoning Chain' if they are relevant. "
        "Challenge the default explanation directly. Consider whether contamination could arise after processing, "
        "during packaging, handling, storage, or complaint interpretation. "
        "Be concise, professional, and evidence-driven. Do not pad the answer with generic hypotheses or action lists."
    ),
    "reasoning": (
        "The user wants a reasoning-focused answer to the exact question they asked. "
        "First answer the question directly in 'Conclusion'. "
        "Then return the 'Reasoning Chain' section only if it helps justify that answer. "
        "Do not include unrelated sections."
    ),
    "actions": (
        "The user wants an action-focused answer to the exact question they asked. "
        "First answer the question directly in 'Conclusion'. "
        "Then return the 'Next Actions' section only if concrete actions are supported by the evidence. "
        "Do not include unrelated sections."
    ),
    "citations": (
        "The user wants an evidence-grounding answer to the exact question they asked. "
        "First answer the question directly in 'Conclusion'. "
        "Then return a short 'Reasoning Chain' focused only on what evidence supports that answer. "
        "Do not include broad hypotheses, Anti-Gravity Challenge, or Next Actions unless they are explicitly required."
    ),
    "summary": (
        "The user wants a SHORT SUMMARY only. "
        "Return a single concise paragraph answering the user's exact question as 'Conclusion' only. "
        "No structured sections, no bullet points."
    ),
    "full": (
        "The user wants a complete but question-specific analysis. "
        "First answer the user's exact question directly in 'Conclusion'. "
        "Then include only the relevant supporting sections from: Hypotheses, Reasoning Chain, "
        "Anti-Gravity Challenge, and Next Actions. "
        "Do not force every section if the evidence does not support it."
    ),
}

PROMPTS = [
    {
        "id": "rca_system_v1",
        "version": "2.0.0",
        "type": "system",
        "description": (
            "System prompt for evidence-backed RCA responses. "
            "Intent-aware — only returns sections the user asked for."
        ),
        "template": (
            # ── Intent instruction (dynamic per query) ──────────────
            "RESPONSE SCOPE: {intent_instruction}\n\n"

            # ── Role ────────────────────────────────────────────────
            "You are an expert quality engineer conducting RCA "
            "(Root Cause Analysis) investigation.\n\n"

            # ── Quality rules ────────────────────────────────────────
            "QUALITY RULES — ENFORCE STRICTLY:\n"
            "1. Answer the user's exact question directly before expanding into supporting analysis.\n"
            "2. DO NOT give generalised answers. Every statement must "
            "be grounded in the ticket or cluster data provided.\n"
            "3. If the question is narrow, keep the answer narrow instead of returning a full RCA template.\n"
            "4. Each hypothesis MUST cite at least one ticket ID or "
            "specific data point from the evidence below.\n"
            "5. Each reasoning step MUST reference an observable fact "
            "from the cluster or tickets.\n"
            "6. Each next action MUST be specific and actionable — "
            "not 'investigate further'.\n"
            "7. If a key field is missing, do NOT stop at 'insufficient data' if the evidence still supports a partial conclusion. "
            "State what the data does show first, then name the missing field, then say what cannot be confirmed.\n"
            "8. AVOID vague phrases: 'may be', 'could be', "
            "'possibly', 'might'.\n"
            "9. Do NOT repeat sections or restate the same point "
            "in different words.\n"
            "10. Keep total output concise — no filler text.\n"
            "11. Numeric confidence values must be based on evidence "
            "frequency — do not fabricate percentages.\n\n"

            "BAD (forbidden):\n"
            "  'Root cause may be a process issue'\n\n"
            "GOOD (required):\n"
            "  'Ticket TKT-8921 shows contamination during production "
            "shift B, indicating process-stage failure at mixing step'\n\n"

            # ── Formatting rules ─────────────────────────────────────
            "FORMATTING RULES:\n"
            "- Never output instruction placeholders or bracketed "
            "template notes\n"
            "- Never return JSON, JSON-like objects, or quoted field names\n"
            "- Never write phrases like 'confidence % based on frequency'\n"
            "- Never include trailing placeholder brackets like '] ]'\n"
            "- Use short, direct evidence-backed statements only\n"
            "- Maximum 5 hypotheses, 6 reasoning steps, 5 next actions\n\n"

            # ── Context ──────────────────────────────────────────────
            "Database Context:\n{db_context}\n\n"
            "Tickets Evidence (Actual customer complaints):\n"
            "{ticket_context}\n\n"
            "User Query: \"{query}\"\n\n"

            # ── Output format ────────────────────────────────────────
            "Respond ONLY with the section(s) specified in RESPONSE SCOPE above.\n"
            "Always include 'Conclusion' first so the answer directly addresses the user's question.\n\n"

            "Conclusion: [Direct answer to the user's exact question, grounded in the evidence. If evidence is insufficient, state exactly what is missing.] \n\n"

            "Hypotheses:\n"
            "- [Specific hypothesis tied to ticket/cluster evidence] (confidence%)\n"
            "- [Alternative hypothesis from different evidence thread] (confidence%)\n\n"

            "Reasoning Chain:\n"
            "- [Specific logical deduction based on ticket frequency/severity]\n"
            "- [Pattern analysis tied to actual ticket evidence]\n"
            "- [Connection between evidence and likely defect source]\n\n"

            "Anti-Gravity Challenge:\n"
            "- [Specific counter-argument: what evidence would disprove "
            "the leading hypothesis]\n\n"

            "Next Actions:\n"
            "- [Specific investigative action tied to suspected root cause]\n"
            "- [Targeted containment or testing specific to defect pattern]\n"
            "- [Verification step to confirm or eliminate leading hypothesis]\n\n"

            "Use citation tags like [DB-CLUSTER], [DB-TICKETS] inside the Conclusion or supporting sections when relevant."
        ),
        "variables": ["db_context", "ticket_context", "query", "intent_instruction"],
        "model_target": "ollama",
        "approved_by": "dev",
        "created_at": "2026-04-26",
    },
    {
        "id": "investigation_questions_v1",
        "version": "1.0.0",
        "type": "task",
        "description": "Generate fresh investigation questions for the RCA copilot canvas.",
        "template": (
            "You are generating fresh investigation prompts for a quality RCA analyst.\n\n"
            "Cluster Context:\n{db_context}\n\n"
            "Ticket Evidence:\n{ticket_context}\n\n"
            "RULES:\n"
            "- Return exactly {question_count} investigation questions\n"
            "- Each question must be one sentence\n"
            "- Each question must be specific to the evidence above\n"
            "- Vary the angle across causality, verification, containment, supplier/process, and counter-hypothesis\n"
            "- Do not repeat the same idea in different words\n"
            "- Do not output JSON\n"
            "- Use this exact format only:\n"
            "QUESTION 1 | rca | <question text>\n"
            "QUESTION 2 | challenge | <question text>\n"
            "QUESTION 3 | hypothesis | <question text>\n"
            "QUESTION 4 | citations | <question text>\n"
        ),
        "variables": ["db_context", "ticket_context", "question_count"],
        "model_target": "ollama",
        "approved_by": "dev",
        "created_at": "2026-04-26",
    },
]


def get_prompt(id: str, version: str = "latest") -> dict:
    matches = [p for p in PROMPTS if p["id"] == id]
    if not matches:
        raise KeyError(f"Prompt '{id}' not found")
    if version == "latest":
        return deepcopy(matches[-1])
    for p in matches:
        if p["version"] == version:
            return deepcopy(p)
    raise KeyError(f"Prompt '{id}' version '{version}' not found")


def render_prompt(id: str, variables: dict) -> str:
    prompt = get_prompt(id)
    # Inject default intent if caller didn't supply one
    if "intent_instruction" not in variables:
        variables = {**variables, "intent_instruction": INTENT_INSTRUCTIONS["full"]}
    return prompt["template"].format(**variables)


def list_prompts() -> list[dict]:
    return [deepcopy(p) for p in PROMPTS]


def get_intent_instruction(intent: str) -> str:
    """Helper — call this in agent.py to get the instruction string."""
    return INTENT_INSTRUCTIONS.get(intent, INTENT_INSTRUCTIONS["full"])
