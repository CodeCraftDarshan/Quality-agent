from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.db.models import ComplaintCluster, InvestigationTicket
from backend.db.session import SessionLocal

from backend.agents.runtime.contracts import AgentContext, ClusterSnapshot, MultiClusterContext, TicketSnapshot


def _trim_text(value: object, limit: int = 160) -> str:
    text = " ".join(str(value or "").split()).strip()
    if limit <= 0 or len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def _cluster_table_columns(db: Session) -> set[str]:
    return {
        str(column.get("name"))
        for column in inspect(db.bind).get_columns("complaint_clusters")
        if column.get("name")
    }


def _load_cluster_rows(db: Session, cluster_ids: list[str]) -> list[dict]:
    available_columns = _cluster_table_columns(db)
    requested_columns = [
        "cluster_id",
        "title",
        "sku",
        "defect_family",
        "count",
        "confidence",
        "severity",
        "ai_summary",
    ]
    select_columns = [column for column in requested_columns if column in available_columns]
    if not select_columns or not cluster_ids:
        return []

    if len(cluster_ids) == 1:
        query = text(
            f"SELECT {', '.join(select_columns)} "
            "FROM complaint_clusters "
            "WHERE cluster_id = :cluster_id"
        )
        return [dict(row) for row in db.execute(query, {"cluster_id": cluster_ids[0]}).mappings().all()]

    placeholders = ", ".join(f":cluster_id_{index}" for index in range(len(cluster_ids)))
    query = text(
        f"SELECT {', '.join(select_columns)} "
        f"FROM complaint_clusters WHERE cluster_id IN ({placeholders})"
    )
    params = {f"cluster_id_{index}": cluster_id for index, cluster_id in enumerate(cluster_ids)}
    return [dict(row) for row in db.execute(query, params).mappings().all()]


class AgentRepository:
    def __init__(self, session_factory=SessionLocal):
        self._session_factory = session_factory

    def load_cluster_context(self, cluster_id: str, ticket_limit: int = 3) -> AgentContext:
        db: Session = self._session_factory()
        try:
            cluster_rows = _load_cluster_rows(db, [cluster_id])
            if not cluster_rows:
                raise ValueError(f"Cluster '{cluster_id}' not found")
            cluster = cluster_rows[0]

            tickets = (
                db.query(InvestigationTicket)
                .filter(InvestigationTicket.cluster_id == cluster_id)
                .all()
            )
        finally:
            db.close()

        cluster_snapshot = ClusterSnapshot(
            cluster_id=str(cluster.get("cluster_id") or cluster_id),
            title=cluster.get("title"),
            sku=cluster.get("sku"),
            defect_family=cluster.get("defect_family"),
            count=int(cluster.get("count") or 0),
            confidence=cluster.get("confidence"),
            severity=cluster.get("severity"),
            ai_summary=cluster.get("ai_summary"),
        )
        ticket_snapshots = tuple(
            TicketSnapshot(
                ticket_id=ticket.ticket_id,
                timestamp=ticket.timestamp,
                content=ticket.content,
                severity=ticket.severity,
                associated_sku=ticket.associated_sku,
            )
            for ticket in tickets
        )

        citations: list[dict[str, str]] = [
            {
                "id": "DB-CLUSTER",
                "source": f"Cluster {cluster_snapshot.cluster_id}",
                "excerpt": cluster_snapshot.ai_summary or cluster_snapshot.title or "",
            }
        ]
        if ticket_snapshots:
            citations.append(
                {
                    "id": "DB-TICKETS",
                    "source": f"Tickets for {cluster_snapshot.cluster_id}",
                    "excerpt": _trim_text(ticket_snapshots[0].content, 220),
                }
            )

        db_context = "\n".join(
            [
                f"Cluster: {_trim_text(cluster_snapshot.title or '', 100)}",
                f"SKU: {_trim_text(cluster_snapshot.sku or '', 40)}",
                f"Defect Family: {_trim_text(cluster_snapshot.defect_family or '', 80)}",
                f"Anomaly Count: {cluster_snapshot.count}",
                f"Confidence: {cluster_snapshot.confidence}",
                f"Cluster Summary: {_trim_text(cluster_snapshot.ai_summary or '', 180)}",
                "Evidence tags: [DB-CLUSTER], [DB-TICKETS]" if ticket_snapshots else "Evidence tags: [DB-CLUSTER]",
            ]
        )
        ticket_context = (
            "\n".join(
                f"- {ticket.ticket_id}"
                f" | {(_trim_text(ticket.timestamp, 40) if ticket.timestamp else 'timestamp unknown')}"
                f" | {(_trim_text(ticket.severity, 20) if ticket.severity else 'severity unknown')}"
                f" | SKU {(_trim_text(ticket.associated_sku, 40) if ticket.associated_sku else 'unknown')}: "
                f"{_trim_text(ticket.content, 180)}"
                for ticket in ticket_snapshots[:ticket_limit]
            )
            if ticket_snapshots
            else "(None)"
        )

        return AgentContext(
            cluster=cluster_snapshot,
            tickets=ticket_snapshots,
            citations=tuple(citations),
            db_context=db_context,
            ticket_context=ticket_context,
        )

    def load_multi_cluster_context(self, cluster_ids: list[str], ticket_limit: int = 8) -> MultiClusterContext:
        normalized_ids = []
        for value in cluster_ids:
            cluster_id = str(value or '').strip()
            if cluster_id and cluster_id not in normalized_ids:
                normalized_ids.append(cluster_id)

        if not normalized_ids:
            raise ValueError('At least one cluster_id is required')

        db: Session = self._session_factory()
        try:
            clusters = _load_cluster_rows(db, normalized_ids)
            cluster_map = {str(cluster.get("cluster_id")): cluster for cluster in clusters}
            missing = [cluster_id for cluster_id in normalized_ids if cluster_id not in cluster_map]
            if missing:
                raise ValueError(f"Cluster '{missing[0]}' not found")

            cluster_snapshots: list[ClusterSnapshot] = []
            ticket_snapshots: list[TicketSnapshot] = []
            citations: list[dict[str, str]] = []
            db_sections: list[str] = []
            ticket_sections: list[str] = []

            for cluster_id in normalized_ids:
                cluster = cluster_map[cluster_id]
                cluster_snapshot = ClusterSnapshot(
                    cluster_id=str(cluster.get("cluster_id") or cluster_id),
                    title=cluster.get("title"),
                    sku=cluster.get("sku"),
                    defect_family=cluster.get("defect_family"),
                    count=int(cluster.get("count") or 0),
                    confidence=cluster.get("confidence"),
                    severity=cluster.get("severity"),
                    ai_summary=cluster.get("ai_summary"),
                )
                cluster_snapshots.append(cluster_snapshot)

                cluster_tickets = (
                    db.query(InvestigationTicket)
                    .filter(InvestigationTicket.cluster_id == cluster_id)
                    .order_by(InvestigationTicket.updated_at.desc())
                    .limit(max(1, ticket_limit))
                    .all()
                )
                cluster_ticket_snapshots = [
                    TicketSnapshot(
                        ticket_id=ticket.ticket_id,
                        timestamp=ticket.timestamp,
                        content=ticket.content,
                        severity=ticket.severity,
                        associated_sku=ticket.associated_sku,
                    )
                    for ticket in cluster_tickets
                ]
                ticket_snapshots.extend(cluster_ticket_snapshots)

                citations.append(
                    {
                        "id": f"DB-CLUSTER-{cluster_id}",
                        "source": f"Cluster {cluster_snapshot.cluster_id}",
                        "excerpt": cluster_snapshot.ai_summary or cluster_snapshot.title or "",
                    }
                )
                if cluster_ticket_snapshots:
                    citations.append(
                        {
                            "id": f"DB-TICKETS-{cluster_id}",
                            "source": f"Tickets for {cluster_snapshot.cluster_id}",
                            "excerpt": _trim_text(cluster_ticket_snapshots[0].content, 220),
                        }
                    )

                db_sections.append(
                    f"Cluster {cluster_snapshot.cluster_id}:"
                    f" Title={_trim_text(cluster_snapshot.title or 'N/A', 100)}"
                    f" | SKU={_trim_text(cluster_snapshot.sku or 'N/A', 40)}"
                    f" | Defect={_trim_text(cluster_snapshot.defect_family or 'N/A', 80)}"
                    f" | Anomaly Count={cluster_snapshot.count}"
                    f" | Confidence={cluster_snapshot.confidence}"
                    f" | Summary={_trim_text(cluster_snapshot.ai_summary or 'N/A', 160)}"
                )
                if cluster_ticket_snapshots:
                    ticket_sections.append(
                        "\n".join(
                            [
                                f"=== CLUSTER {cluster_snapshot.cluster_id} ({cluster_snapshot.defect_family or 'Unknown'}) ===",
                                *[
                                    f"  [{cluster_snapshot.cluster_id}] {ticket.ticket_id}: {_trim_text(ticket.content, 200)}"
                                    f" | time={_trim_text(ticket.timestamp, 40) if ticket.timestamp else 'unknown'}"
                                    f" | severity={_trim_text(ticket.severity, 20) if ticket.severity else 'unknown'}"
                                    f" | sku={_trim_text(ticket.associated_sku, 40) if ticket.associated_sku else 'unknown'}"
                                    for ticket in cluster_ticket_snapshots
                                ],
                            ]
                        )
                    )

        finally:
            db.close()

        primary_cluster = cluster_snapshots[0]
        return MultiClusterContext(
            cluster=primary_cluster,
            clusters=tuple(cluster_snapshots),
            tickets=tuple(ticket_snapshots),
            citations=tuple(citations),
            db_context="\n".join(db_sections),
            ticket_context="\n".join(ticket_sections),
            cluster_ids=tuple(normalized_ids),
        )
