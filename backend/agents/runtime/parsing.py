from __future__ import annotations

import json
import re

from backend.agents.runtime.contracts import (
    Citation,
    Hypothesis,
    InvestigationQuestion,
    LocalAnalysisBundle,
    ParsedReply,
    TaskType,
)

MAX_HYPOTHESES = 5
MAX_REASONING_STEPS = 6
MAX_NEXT_ACTIONS = 5

SECTION_LABELS = {
    "conclusion": "conclusion",
    "direct answer": "conclusion",
    "hypotheses": "hypotheses",
    "reasoning chain": "reasoning_chain",
    "anti-gravity challenge": "anti_gravity_challenge",
    "next actions": "next_actions",
}


def trim_text(value: object, limit: int = 160) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if limit <= 0 or len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def clean_bullet(value: object) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^[-*•]\s*", "", text)
    text = re.sub(r"^\d+[.)]\s*", "", text)
    return text.strip()


def clean_text_noise(value: str) -> str:
    cleaned = str(value or "")
    cleaned = re.sub(r"//.*$", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\[\s*confidence\s+at\s+least\s+around[^\]]*\]", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bconfidence\s*%\s*based\s*on\s*frequency\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\s*Hypotheses\s*:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.split(
        r"\b(?:Reasoning Chain|Next Actions|Anti-Gravity Challenge|Conclusion)\s*:",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = cleaned.replace("\"", "").replace("'", "")
    cleaned = re.sub(r"\s*\]{1,}\s*$", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = cleaned.strip(" ,:;{}[]")
    return cleaned.strip()


def short_summary(value: object, limit: int = 260) -> str:
    return trim_text(clean_text_noise(clean_bullet(value)), limit=limit)


def parse_confidence(value: object) -> float | None:
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 1:
            number = number / 100
        return max(0.0, min(1.0, number))

    text = str(value or "").strip().lower()
    if not text:
        return None
    if "high" in text:
        return 0.8
    if "medium" in text:
        return 0.6
    if "low" in text:
        return 0.4

    pct = re.search(r"(\d{1,3})\s*%", text)
    if pct:
        return max(0.0, min(1.0, int(pct.group(1)) / 100))
    return None


def _coerce_to_list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def extract_sections_from_reply(text: str) -> dict[str, list[str]]:
    sections = {
        "conclusion": [],
        "hypotheses": [],
        "reasoning_chain": [],
        "anti_gravity_challenge": [],
        "next_actions": [],
    }
    current: str | None = None
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue

        inline = re.match(r"^([A-Za-z\s-]+):\s+(.+)$", line)
        if inline:
            header = inline.group(1).strip().lower()
            value = inline.group(2).strip()
            if header in SECTION_LABELS:
                current = SECTION_LABELS[header]
                if value:
                    sections[current].append(value)
                continue

        header_only = line.strip("* ").rstrip(":").lower()
        if header_only in SECTION_LABELS:
            current = SECTION_LABELS[header_only]
            continue

        if current:
            sections[current].append(line)
    return sections


def extract_hypotheses_from_lines(lines: list[str]) -> tuple[Hypothesis, ...]:
    output: list[Hypothesis] = []
    for raw in lines:
        cleaned = clean_bullet(raw)
        if not cleaned:
            continue

        confidence = None
        match = re.search(r"(\d{1,3})\s*%", cleaned)
        if match:
            confidence = max(0.0, min(1.0, int(match.group(1)) / 100))
            cleaned = re.sub(r"\(?\s*\d{1,3}\s*%\s*\)?", "", cleaned).strip(" :-")

        cleaned = re.sub(r"\[\s*confidence\s+at\s+least\s+around[^\]]*\]", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*\]{1,}\s*$", "", cleaned).strip()
        if cleaned:
            output.append(Hypothesis(title=cleaned, confidence=confidence))
    return tuple(output[:MAX_HYPOTHESES])


def _try_parse_json_like_reply(reply_text: str) -> dict[str, object] | None:
    raw = str(reply_text or "").strip()
    if not raw or not (raw.startswith("{") or raw.startswith("[")):
        return None

    candidate = raw.replace("```json", "").replace("```", "")
    candidate = re.sub(r"//.*$", "", candidate, flags=re.MULTILINE)
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
    try:
        parsed = json.loads(candidate)
    except Exception:
        return None

    if isinstance(parsed, list):
        return {"summary": parsed}
    if isinstance(parsed, dict):
        return parsed
    return None


def _extract_structured_from_json_reply(reply_text: str) -> dict[str, object]:
    parsed = _try_parse_json_like_reply(reply_text)
    if not parsed:
        return {
            "conclusion": None,
            "hypotheses": (),
            "reasoning_chain": (),
            "anti_gravity_challenge": None,
            "next_actions": (),
            "summary": None,
        }

    hypotheses: list[Hypothesis] = []
    for item in _coerce_to_list(parsed.get("hypotheses") or parsed.get("Hypotheses")):
        if isinstance(item, dict):
            title = clean_text_noise(item.get("title") or item.get("hypothesis") or "")
            detail = clean_text_noise(item.get("detail") or item.get("reason") or "")
            confidence = parse_confidence(item.get("confidence") or item.get("score"))
            combined = f"{title}: {detail}" if title and detail else title or detail
            if combined:
                hypotheses.append(Hypothesis(title=combined, confidence=confidence))
            continue
        line = clean_text_noise(item)
        if line:
            hypotheses.append(Hypothesis(title=line, confidence=parse_confidence(line)))

    reasoning_chain: list[str] = []
    for item in _coerce_to_list(parsed.get("reasoning_chain") or parsed.get("Reasoning Chain")):
        line = clean_text_noise(item.get("reason") or item.get("detail") or "") if isinstance(item, dict) else clean_text_noise(item)
        if line:
            reasoning_chain.append(line)

    challenge = clean_text_noise(
        parsed.get("anti_gravity_challenge")
        or parsed.get("Anti-Gravity Challenge")
        or parsed.get("challenge")
        or ""
    ) or None

    next_actions: list[str] = []
    for item in _coerce_to_list(parsed.get("next_actions") or parsed.get("Next Actions") or parsed.get("actions")):
        line = clean_text_noise(item)
        if line:
            next_actions.append(line)

    summary = clean_text_noise(
        parsed.get("reply")
        or parsed.get("summary")
        or parsed.get("conclusion")
        or parsed.get("Conclusion")
        or ""
    )

    return {
        "conclusion": clean_text_noise(parsed.get("conclusion") or parsed.get("Conclusion") or ""),
        "hypotheses": tuple(hypotheses[:MAX_HYPOTHESES]),
        "reasoning_chain": tuple(reasoning_chain[:MAX_REASONING_STEPS]),
        "anti_gravity_challenge": challenge,
        "next_actions": tuple(next_actions[:MAX_NEXT_ACTIONS]),
        "summary": summary or None,
    }


def extract_direct_answer(parsed_sections: dict[str, list[str]], raw_reply: str) -> str:
    conclusion_lines = [
        clean_text_noise(clean_bullet(line))
        for line in parsed_sections.get("conclusion", [])
        if clean_text_noise(clean_bullet(line))
    ]
    if conclusion_lines:
        return " ".join(conclusion_lines[:2]).strip()

    match = re.search(
        r"(?:^|\n)\s*(?:Conclusion|Direct Answer)\s*:\s*(.+?)(?:\n\s*[A-Za-z][A-Za-z\s-]*:\s*|\Z)",
        str(raw_reply or ""),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return short_summary(match.group(1), limit=320)
    return short_summary(raw_reply, limit=320)


def needs_reply_cleanup(value: str) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return True
    if any(
        text.startswith(prefix)
        for prefix in [
            "hypotheses:",
            "reasoning chain:",
            "challenge:",
            "anti-gravity challenge:",
            "next actions:",
        ]
    ):
        return True
    return bool(re.search(r"\b[a-z_]+:\s*", text))


def compose_reply_from_structured_fields(
    query: str,
    hypotheses: tuple[Hypothesis, ...],
    reasoning_chain: tuple[str, ...],
    anti_gravity_challenge: str | None,
    next_actions: tuple[str, ...],
) -> str:
    query_snippet = trim_text(query, 120)
    if anti_gravity_challenge:
        return trim_text(f"For '{query_snippet}', the strongest counterpoint is: {anti_gravity_challenge}", limit=320)
    if hypotheses:
        return trim_text(f"For '{query_snippet}', the strongest evidence-backed hypothesis is: {hypotheses[0].title}", limit=320)
    if reasoning_chain:
        return trim_text(f"For '{query_snippet}', the key evidence chain starts with: {reasoning_chain[0]}", limit=320)
    if next_actions:
        return trim_text(f"For '{query_snippet}', the immediate next step is: {next_actions[0]}", limit=320)
    return ""


def build_citations_from_tags(reply_text: str, known_citations: tuple[dict[str, str], ...]) -> tuple[Citation, ...]:
    by_id = {item["id"]: item for item in known_citations if item.get("id")}
    tags = re.findall(r"\[([A-Z]+-[A-Z0-9_-]+)\]", str(reply_text or ""))
    if not tags:
        return tuple(Citation(**item) for item in known_citations[:3])

    result: list[Citation] = []
    seen: set[str] = set()
    for tag in tags:
        if tag in seen:
            continue
        seen.add(tag)
        if tag in by_id:
            result.append(Citation(**by_id[tag]))
        else:
            result.append(Citation(id=tag, source=tag.replace("-", " ").title(), excerpt=""))
    return tuple(result[:5])


def parse_agent_reply(query: str, reply_text: str, known_citations: tuple[dict[str, str], ...]) -> ParsedReply:
    parsed = extract_sections_from_reply(reply_text)
    summary = extract_direct_answer(parsed, reply_text)

    hypotheses = extract_hypotheses_from_lines(parsed["hypotheses"])
    reasoning_chain = tuple(
        clean_text_noise(clean_bullet(x))
        for x in parsed["reasoning_chain"]
        if clean_text_noise(clean_bullet(x))
    )[:MAX_REASONING_STEPS]
    anti_gravity_challenge = (
        clean_text_noise(clean_bullet(parsed["anti_gravity_challenge"][0]))
        if parsed["anti_gravity_challenge"]
        else None
    )
    next_actions = tuple(
        clean_text_noise(clean_bullet(x))
        for x in parsed["next_actions"]
        if clean_text_noise(clean_bullet(x))
    )[:MAX_NEXT_ACTIONS]

    if not hypotheses and not reasoning_chain and not next_actions and not anti_gravity_challenge:
        extracted = _extract_structured_from_json_reply(reply_text)
        hypotheses = extracted["hypotheses"]
        reasoning_chain = extracted["reasoning_chain"]
        anti_gravity_challenge = extracted["anti_gravity_challenge"]
        next_actions = extracted["next_actions"]
        summary = extracted["summary"] or extracted["conclusion"] or short_summary(reply_text, limit=320)

    if needs_reply_cleanup(summary):
        summary = compose_reply_from_structured_fields(
            query=query,
            hypotheses=hypotheses,
            reasoning_chain=reasoning_chain,
            anti_gravity_challenge=anti_gravity_challenge,
            next_actions=next_actions,
        ) or short_summary(reply_text, limit=320)

    return ParsedReply(
        summary=summary,
        hypotheses=hypotheses,
        reasoning_chain=reasoning_chain,
        anti_gravity_challenge=anti_gravity_challenge,
        next_actions=next_actions,
        citations=build_citations_from_tags(reply_text, known_citations),
        raw_reply=reply_text,
    )


def build_local_analysis_bundle(query: str, cluster, tickets, citations: tuple[dict[str, str], ...]) -> LocalAnalysisBundle:
    hypothesis_text = (
        f"Cluster {cluster.cluster_id} indicates recurring {cluster.defect_family or 'defect'} signals in "
        f"{len(tickets)} tickets around SKU {cluster.sku or 'unknown'} (78%)."
    )
    reasoning = (
        f"Cluster anomaly count is {cluster.count}, indicating concentration rather than isolated noise.",
        "Ticket evidence repeatedly mentions hard/metallic foreign-object symptoms.",
        "Severity distribution supports focused containment and validation of canning-line contamination risk.",
    )
    next_actions = (
        f"Inspect canning equipment and metal detection checkpoints for {cluster.sku or cluster.cluster_id}.",
        "Cross-check lot and shift patterns for the highest-severity tickets.",
        "Verify retained samples to confirm the same defect family before escalation.",
    )
    direct_answer = (
        f"Local analysis for '{trim_text(query, 120)}' points to the strongest evidence around "
        f"{cluster.defect_family or 'the active defect pattern'} in cluster {cluster.cluster_id}, "
        f"but this answer is limited to database evidence because Ollama is unavailable. [DB-CLUSTER] [DB-TICKETS]"
    )
    return LocalAnalysisBundle(
        direct_answer=direct_answer,
        hypotheses=(Hypothesis(title=hypothesis_text, confidence=0.78),),
        reasoning_chain=reasoning,
        anti_gravity_challenge="If retained samples do not reproduce the defect, grouping may be over-broad.",
        next_actions=next_actions,
        citations=build_citations_from_tags("[DB-CLUSTER] [DB-TICKETS]", citations),
    )


def build_local_analysis_bundle_multi(query: str, clusters, tickets, citations: tuple[dict[str, str], ...]) -> LocalAnalysisBundle:
    cluster_ids = [getattr(cluster, "cluster_id", "UNKNOWN") for cluster in clusters if getattr(cluster, "cluster_id", None)]
    primary_cluster = clusters[0]
    shared_sku = primary_cluster.sku or ", ".join(sorted({getattr(cluster, "sku", None) or "unknown" for cluster in clusters}))
    shared_defect = primary_cluster.defect_family or ", ".join(sorted({getattr(cluster, "defect_family", None) or "unclassified" for cluster in clusters}))

    hypothesis_text = (
        f"Clusters {', '.join(cluster_ids)} show a recurring {shared_defect} pattern across {len(tickets)} tickets."
    )
    reasoning = (
        f"The investigation spans {len(cluster_ids)} clusters, which suggests a shared upstream driver rather than isolated noise.",
        f"The combined ticket set points to overlapping symptoms around SKU {shared_sku}.",
        "Cross-cluster similarity increases the likelihood of a shared supplier, batch, or handling root cause.",
    )
    next_actions = (
        f"Review shared production, packaging, and supplier records for clusters {', '.join(cluster_ids)}.",
        "Compare the earliest and highest-severity complaints across the selected clusters for common defect markers.",
        "Validate whether the same containment action resolves the issue across all selected clusters.",
    )
    direct_answer = (
        f"Local analysis for '{trim_text(query, 120)}' suggests a shared defect signal across clusters {', '.join(cluster_ids)}, "
        f"but this answer is limited to database evidence because Ollama is unavailable. [DB-CLUSTER] [DB-TICKETS]"
    )
    return LocalAnalysisBundle(
        direct_answer=direct_answer,
        hypotheses=(Hypothesis(title=hypothesis_text, confidence=0.78),),
        reasoning_chain=reasoning,
        anti_gravity_challenge="If one selected cluster lacks the pattern, the shared-cause hypothesis may be too broad.",
        next_actions=next_actions,
        citations=build_citations_from_tags("[DB-CLUSTER] [DB-TICKETS]", citations),
    )


def parse_investigation_questions(raw_text: str, question_count: int) -> list[InvestigationQuestion]:
    questions: list[InvestigationQuestion] = []
    valid_task_types = {item.value for item in TaskType}

    for line in str(raw_text or "").splitlines():
        cleaned = trim_text(line, 320).strip()
        if not cleaned:
            continue

        match = re.match(r"^QUESTION\s+\d+\s*\|\s*([a-zA-Z_-]+)\s*\|\s*(.+)$", cleaned, flags=re.IGNORECASE)
        if match:
            task_type = match.group(1).strip().lower()
            text = clean_text_noise(match.group(2))
            if text:
                questions.append(
                    InvestigationQuestion(
                        text=text,
                        task_type=task_type if task_type in valid_task_types else TaskType.RCA.value,
                    )
                )
            continue

        fallback = clean_text_noise(clean_bullet(cleaned))
        if fallback:
            questions.append(InvestigationQuestion(text=fallback, task_type=TaskType.RCA.value))

    deduped: list[InvestigationQuestion] = []
    seen: set[str] = set()
    for item in questions:
        key = re.sub(r"\s+", " ", item.text.lower()).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= question_count:
            break
    return deduped
