def compute_confidence(response: dict, retrieved_chunks: list) -> float:
    score = 1.0
    if not response.get("citations"):
        score -= 0.3
    if not response.get("hypotheses"):
        score -= 0.2
    if len(response.get("reasoning_chain", [])) < 2:
        score -= 0.2
    if len(retrieved_chunks) >= 3:
        score += 0.1
    return max(0.0, min(1.0, round(score, 2)))
