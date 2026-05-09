HITL_TRIGGERS = {
    "low_confidence": 0.4,
    "no_citations": True,
    "high_risk_keywords": ["shutdown", "delete", "purge", "escalate immediately"],
}


def should_flag_for_hitl(response: dict) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    confidence = float(response.get("confidence", 1.0) or 0.0)
    if confidence < HITL_TRIGGERS["low_confidence"]:
        reasons.append("low_confidence")
    if HITL_TRIGGERS["no_citations"] and not response.get("citations"):
        reasons.append("no_citations")
    text = " ".join(
        [
            response.get("reply", "") or "",
            " ".join(response.get("next_actions", []) or []),
            response.get("anti_gravity_challenge", "") or "",
        ]
    ).lower()
    for keyword in HITL_TRIGGERS["high_risk_keywords"]:
        if keyword in text:
            reasons.append(f"high_risk_keyword:{keyword}")
    return (len(reasons) > 0, reasons)
