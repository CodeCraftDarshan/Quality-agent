import csv
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime

from fastapi import Body, Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.agents.runtime.service import AgentRuntimeError
from backend.api import (
    admin_router,
    clusters_router,
    dashboard_router,
    investigate_router,
    tickets_router,
    todos_router,
)
from backend.auth.bypass import router as auth_router
from backend.core.config import ALLOW_CREDENTIALS, ALLOWED_ORIGINS
from backend.db.models import ComplaintCluster, InvestigationTicket, TraceabilityEdge, TraceabilityNode
from backend.db.session import SessionLocal, init_db
from backend.utils.error_codes import build_error_response
from backend.middleware.request_id import add_request_id
from backend.openapi import build_openapi_schema
from backend.utils.audit import append_audit_entry
from backend.utils.logger import configure_logging

configure_logging()

logger = logging.getLogger(__name__)

TRACEABILITY_TYPES = {"raw_material", "assembly_unit", "finished_good"}
TRACEABILITY_STATUSES = {"active", "flagged", "contained", "recalled"}
TRACEABILITY_RELATIONSHIPS = {"supplies", "produces", "contains"}
SUPPLIER_PATTERN = re.compile(
    r"\b(?:supplier|co[- ]?packer|vendor)\s*[:#-]?\s*([A-Z][A-Za-z0-9&.\- ]{2,})",
    re.IGNORECASE,
)
BATCH_PATTERN = re.compile(
    r"\b((?:batch|lot)\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]*)\b",
    re.IGNORECASE,
)


class TraceabilityNodeCreateRequest(BaseModel):
    name: str
    type: str
    sku: str | None = None
    location: str | None = None
    supplier: str | None = None
    batch_number: str | None = None
    risk_score: float = 0.0
    cluster_id: str | None = None


class TraceabilityStatusUpdateRequest(BaseModel):
    status: str


class TraceabilityContainRequest(BaseModel):
    actions: list[str] = []
    notes: str = ""


class TraceabilityExportRequest(BaseModel):
    node_id: str | None = None
    format: str = "json"


def _traceability_metadata(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _serialize_traceability_node(node: TraceabilityNode) -> dict:
    return {
        "id": node.id,
        "name": node.name,
        "type": node.type,
        "sku": node.sku,
        "location": node.location,
        "supplier": node.supplier,
        "batch_number": node.batch_number,
        "risk_score": float(node.risk_score or 0.0),
        "status": node.status,
        "cluster_id": node.cluster_id,
        "created_at": node.created_at,
        "metadata": _traceability_metadata(node.metadata_json),
    }


def _serialize_traceability_edge(edge: TraceabilityEdge) -> dict:
    return {
        "id": edge.id,
        "source_id": edge.source_id,
        "target_id": edge.target_id,
        "relationship": edge.relationship,
        "created_at": edge.created_at,
    }


def _normalize_traceability_status(status_value: str | None) -> str:
    normalized = str(status_value or "").strip().lower()
    return normalized if normalized in TRACEABILITY_STATUSES else "active"


def _normalize_traceability_type(type_value: str | None) -> str:
    normalized = str(type_value or "").strip().lower()
    if normalized not in TRACEABILITY_TYPES:
        raise HTTPException(status_code=422, detail="Invalid traceability node type")
    return normalized


def _normalize_relationship(relationship: str | None) -> str:
    normalized = str(relationship or "").strip().lower()
    return normalized if normalized in TRACEABILITY_RELATIONSHIPS else "supplies"


def _slugify_traceability_value(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "unknown"


def _extract_traceability_entities(*values: str | None) -> list[dict[str, str]]:
    entities: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for value in values:
        text_value = str(value or "")
        for match in BATCH_PATTERN.findall(text_value):
            label = re.sub(r"\s+", " ", match.strip())
            key = ("batch", label.lower())
            if label and key not in seen:
                seen.add(key)
                entities.append({"kind": "batch", "label": label})
        for match in SUPPLIER_PATTERN.findall(text_value):
            label = re.sub(r"\s+", " ", match.strip(" .,:;"))
            key = ("supplier", label.lower())
            if label and key not in seen:
                seen.add(key)
                entities.append({"kind": "supplier", "label": label})
    return entities


def _build_connected_subgraph(node_id: str, db: Session) -> tuple[list[TraceabilityNode], list[TraceabilityEdge]]:
    all_edges = db.query(TraceabilityEdge).all()
    edge_map: dict[str, list[TraceabilityEdge]] = {}
    reverse_map: dict[str, list[TraceabilityEdge]] = {}
    for edge in all_edges:
        edge_map.setdefault(edge.source_id, []).append(edge)
        reverse_map.setdefault(edge.target_id, []).append(edge)

    seen_nodes = {node_id}
    queue = [node_id]
    selected_edges: dict[str, TraceabilityEdge] = {}

    while queue:
        current = queue.pop(0)
        for edge in edge_map.get(current, []):
            selected_edges[edge.id] = edge
            if edge.target_id not in seen_nodes:
                seen_nodes.add(edge.target_id)
                queue.append(edge.target_id)
        for edge in reverse_map.get(current, []):
            selected_edges[edge.id] = edge
            if edge.source_id not in seen_nodes:
                seen_nodes.add(edge.source_id)
                queue.append(edge.source_id)

    nodes = db.query(TraceabilityNode).filter(TraceabilityNode.id.in_(seen_nodes)).all() if seen_nodes else []
    return nodes, list(selected_edges.values())


def _build_impact_payload(node: TraceabilityNode, db: Session) -> dict:
    all_nodes = {item.id: item for item in db.query(TraceabilityNode).all()}
    all_edges = db.query(TraceabilityEdge).all()
    outgoing: dict[str, list[TraceabilityEdge]] = {}
    for edge in all_edges:
        outgoing.setdefault(edge.source_id, []).append(edge)

    downstream_ids: list[str] = []
    seen = {node.id}
    queue = [node.id]
    while queue:
        current = queue.pop(0)
        for edge in outgoing.get(current, []):
            if edge.target_id in seen:
                continue
            seen.add(edge.target_id)
            downstream_ids.append(edge.target_id)
            queue.append(edge.target_id)

    downstream_nodes = [all_nodes[item_id] for item_id in downstream_ids if item_id in all_nodes]
    cluster_ids = {item.cluster_id for item in [node, *downstream_nodes] if item.cluster_id}
    clusters = (
        db.query(ComplaintCluster)
        .filter(ComplaintCluster.cluster_id.in_(cluster_ids))
        .all()
        if cluster_ids
        else []
    )
    cluster_by_id = {cluster.cluster_id: cluster for cluster in clusters}
    total_impacted_units = sum(int(cluster_by_id[cluster_id].count or 0) for cluster_id in cluster_ids if cluster_id in cluster_by_id)
    if total_impacted_units == 0:
        total_impacted_units = len(downstream_nodes)
    scores = [float(item.risk_score or 0.0) for item in [node, *downstream_nodes]]
    risk_propagation = max(scores) if scores else 0.0

    recommended_actions: list[str] = []
    if float(node.risk_score or 0.0) >= 0.7:
        recommended_actions.append("Prioritize containment for this node before additional downstream releases.")
    if cluster_ids:
        recommended_actions.append(f"Review linked complaint clusters: {', '.join(sorted(cluster_ids))}.")
    if node.supplier or node.batch_number:
        recommended_actions.append("Notify the upstream supplier or batch owner and request retained sample verification.")
    if downstream_nodes:
        recommended_actions.append("Trace all downstream nodes for hold, quarantine, or recall readiness.")
    if not recommended_actions:
        recommended_actions.append("Continue monitoring this node; no downstream propagation is currently linked.")

    return {
        "node_id": node.id,
        "downstream_nodes": [_serialize_traceability_node(item) for item in downstream_nodes],
        "total_impacted_units": int(total_impacted_units),
        "risk_propagation": float(min(1.0, max(0.0, risk_propagation))),
        "affected_clusters": [
            {
                "cluster_id": cluster.cluster_id,
                "title": cluster.title,
                "count": cluster.count,
                "severity": cluster.severity,
            }
            for cluster in clusters
        ],
        "recommended_actions": recommended_actions,
    }


def _seed_traceability_graph(db: Session) -> dict[str, int]:
    created_nodes = 0
    created_edges = 0
    created_node_ids: set[str] = set()
    pending_edges: list[TraceabilityEdge] = []

    clusters = db.query(ComplaintCluster).all()
    for cluster in clusters:
        finished_good_id = f"fg-{cluster.cluster_id}"
        assembly_unit_id = f"asm-{cluster.cluster_id}"
        finished_good = db.get(TraceabilityNode, finished_good_id)
        if finished_good is None:
            finished_good = TraceabilityNode(
                id=finished_good_id,
                name=cluster.title or cluster.cluster_id,
                type="finished_good",
                sku=cluster.sku,
                location="Cluster-derived finished good",
                batch_number=cluster.cluster_id,
                risk_score=min(1.0, float((cluster.count or 0) / 100.0) * float(cluster.confidence or 0.0)),
                status="flagged" if (cluster.status or "open") == "open" else "active",
                cluster_id=cluster.cluster_id,
                metadata_json=json.dumps(
                    {
                        "defect_family": cluster.defect_family,
                        "severity": cluster.severity,
                        "summary": cluster.ai_summary,
                    }
                ),
            )
            db.add(finished_good)
            created_nodes += 1
            created_node_ids.add(finished_good_id)

        assembly_unit = db.get(TraceabilityNode, assembly_unit_id)
        if assembly_unit is None:
            assembly_unit = TraceabilityNode(
                id=assembly_unit_id,
                name=f"{cluster.defect_family or 'Assembly'} Unit - {cluster.cluster_id}",
                type="assembly_unit",
                sku=cluster.sku,
                location="Cluster-derived assembly unit",
                batch_number=cluster.cluster_id,
                risk_score=min(1.0, max(float(cluster.confidence or 0.0), float((cluster.count or 0) / 100.0))),
                status="flagged" if (cluster.status or "open") == "open" else "active",
                cluster_id=cluster.cluster_id,
                metadata_json=json.dumps(
                    {
                        "stage": "assembly",
                        "defect_family": cluster.defect_family,
                        "severity": cluster.severity,
                        "summary": cluster.ai_summary,
                    }
                ),
            )
            db.add(assembly_unit)
            created_nodes += 1
            created_node_ids.add(assembly_unit_id)

        assembly_edge_id = f"edge-{assembly_unit_id}-{finished_good_id}"
        existing_assembly_edge = db.get(TraceabilityEdge, assembly_edge_id)
        if existing_assembly_edge is None:
            pending_edges.append(
                TraceabilityEdge(
                    id=assembly_edge_id,
                    source_id=assembly_unit_id,
                    target_id=finished_good_id,
                    relationship="produces",
                )
            )
            created_edges += 1

        cluster_tickets = (
            db.query(InvestigationTicket)
            .filter(InvestigationTicket.cluster_id == cluster.cluster_id)
            .all()
        )
        entities = _extract_traceability_entities(
            cluster.ai_summary,
            *[ticket.content for ticket in cluster_tickets],
        )
        for entity in entities:
            label = entity["label"]
            kind = entity["kind"]
            raw_id = f"raw-{kind}-{_slugify_traceability_value(label)}"
            raw_node = db.get(TraceabilityNode, raw_id)
            if raw_node is None:
                raw_node = TraceabilityNode(
                    id=raw_id,
                    name=label,
                    type="raw_material",
                    location="Ticket-derived upstream signal",
                    supplier=label if kind == "supplier" else None,
                    batch_number=label if kind == "batch" else None,
                    risk_score=min(1.0, float(cluster.confidence or 0.0)),
                    status="flagged" if (cluster.status or "open") == "open" else "active",
                    cluster_id=cluster.cluster_id,
                    metadata_json=json.dumps({"source": "ticket_content", "kind": kind}),
                )
                db.add(raw_node)
                created_nodes += 1
                created_node_ids.add(raw_id)

            edge_id = f"edge-{raw_id}-{finished_good_id}"
            existing_edge = db.get(TraceabilityEdge, edge_id)
            if existing_edge is None:
                pending_edges.append(
                    TraceabilityEdge(
                        id=edge_id,
                        source_id=raw_id,
                        target_id=assembly_unit_id,
                        relationship="supplies",
                    )
                )
                created_edges += 1

    # Make sure all newly created nodes exist in the database before any
    # edge insert references them. This avoids FK violations on Postgres.
    db.flush()
    if pending_edges:
        db.add_all(pending_edges)
    db.commit()
    return {"nodes_created": created_nodes, "edges_created": created_edges, "node_ids": len(created_node_ids)}


async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", None)
    status_to_error_code = {
        status.HTTP_400_BAD_REQUEST: "RCA_005",
        status.HTTP_401_UNAUTHORIZED: "AUTH_001",
        status.HTTP_403_FORBIDDEN: "AUTH_004",
        status.HTTP_404_NOT_FOUND: "RES_001",
        status.HTTP_422_UNPROCESSABLE_ENTITY: "RCA_005",
        status.HTTP_429_TOO_MANY_REQUESTS: "RCA_003",
        status.HTTP_502_BAD_GATEWAY: "RCA_001",
        status.HTTP_503_SERVICE_UNAVAILABLE: "RCA_002",
    }
    error_code = status_to_error_code.get(exc.status_code, "RCA_007")
    detail = exc.detail
    if isinstance(detail, dict) and detail.get("error_code"):
        error_code = detail["error_code"]
        detail_message = detail.get("message") or str(detail)
    else:
        detail_message = detail if isinstance(detail, str) else str(detail)
    error_response = build_error_response(
        error_code=error_code,
        custom_message=detail_message,
        request_id=request_id,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response,
        headers={"X-Request-ID": request_id or ""},
    )


async def agent_runtime_exception_handler(request: Request, exc: AgentRuntimeError):
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=exc.status_code,
        content=build_error_response(
            error_code=exc.error_code,
            custom_message=exc.message,
            request_id=request_id,
        ),
        headers={"X-Request-ID": request_id or ""},
    )


async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=build_error_response(
            error_code="RCA_005",
            custom_message=str(exc),
            request_id=request_id,
        ),
        headers={"X-Request-ID": request_id or ""},
    )


async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", None)
    logger.exception("Unhandled server error on %s", request.url.path if request else "unknown-path")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=build_error_response(
            error_code="RCA_007",
            custom_message="Internal Server Error",
            request_id=request_id,
        ),
        headers={"X-Request-ID": request_id or ""},
    )


def on_startup():
    init_db()
    db = SessionLocal()
    try:
        cluster_count = db.execute(text("SELECT COUNT(*) FROM complaint_clusters")).scalar_one()
        if cluster_count == 0:
            clusters = [
                ComplaintCluster(
                    cluster_id="CL-992",
                    title="Foreign Object - Canned Beans",
                    count=142,
                    first_seen="Oct 24, 2023",
                    last_seen="2h ago",
                    confidence=0.92,
                    severity="Critical",
                    sku="CB-15-ORG",
                    defect_family="Foreign Object",
                    ai_summary="High confidence anomaly localized to Batch 402.",
                ),
                ComplaintCluster(
                    cluster_id="CL-984",
                    title="Sour Taste - 1% Milk",
                    count=84,
                    first_seen="Oct 25, 2023",
                    last_seen="5h ago",
                    confidence=0.89,
                    severity="Medium",
                    sku="Dairy",
                    defect_family="Taste",
                    ai_summary="90% localized to Northeast distribution.",
                ),
                ComplaintCluster(
                    cluster_id="CL-971",
                    title="Packaging Defect - Cereal Box",
                    count=12,
                    first_seen="Oct 22, 2023",
                    last_seen="1d ago",
                    confidence=0.6,
                    severity="Low",
                    sku="Packaging",
                    defect_family="Damage",
                    ai_summary="Likely transit damage, monitoring.",
                ),
            ]
            db.add_all(clusters)

            tickets = [
                InvestigationTicket(
                    ticket_id="TKT-8921",
                    cluster_id="CL-992",
                    timestamp="10:42 AM",
                    content="Found a sharp piece of metal while eating my beans. Luckily I didn't swallow it.",
                    severity="High",
                    associated_sku="CB-15-ORG",
                ),
                InvestigationTicket(
                    ticket_id="TKT-8894",
                    cluster_id="CL-992",
                    timestamp="03:15 PM",
                    content="There was something hard in the can, almost broke a tooth.",
                    severity="Medium",
                    associated_sku="CB-15-LOW",
                ),
                InvestigationTicket(
                    ticket_id="TKT-8850",
                    cluster_id="CL-992",
                    timestamp="08:20 AM",
                    content="Opened the can and noticed a strange metallic smell.",
                    severity="High",
                    associated_sku="CB-15-ORG",
                ),
                InvestigationTicket(
                    ticket_id="TKT-9012",
                    cluster_id="CL-984",
                    timestamp="11:30 AM",
                    content="Milk has a very sour, chemical taste. Batch 4419.",
                    severity="Medium",
                    associated_sku="Dairy-M-01",
                ),
                InvestigationTicket(
                    ticket_id="TKT-9015",
                    cluster_id="CL-984",
                    timestamp="01:45 PM",
                    content="Unusual smell upon opening the carton. Tastes fermented.",
                    severity="Medium",
                    associated_sku="Dairy-M-01",
                ),
                InvestigationTicket(
                    ticket_id="TKT-9020",
                    cluster_id="CL-992",
                    timestamp="Nov 01, 10:15 AM",
                    content="Found a small piece of plastic with the beans.",
                    severity="Medium",
                    associated_sku="CB-15-ORG",
                ),
                InvestigationTicket(
                    ticket_id="TKT-9021",
                    cluster_id="CL-971",
                    timestamp="Nov 02, 09:30 AM",
                    content="The cereal box was completely crushed on the bottom left corner.",
                    severity="Low",
                    associated_sku="Packaging",
                ),
                InvestigationTicket(
                    ticket_id="TKT-9022",
                    cluster_id="CL-971",
                    timestamp="Nov 03, 08:45 AM",
                    content="Box came ripped open but interior bag was sealed.",
                    severity="Low",
                    associated_sku="Packaging",
                ),
                InvestigationTicket(
                    ticket_id="TKT-9023",
                    cluster_id="CL-984",
                    timestamp="Nov 04, 05:20 PM",
                    content="Tastes like it expired weeks ago, but date is fine.",
                    severity="Medium",
                    associated_sku="Dairy-M-01",
                ),
            ]
            db.add_all(tickets)
            db.commit()
    finally:
        db.close()


def create_app() -> FastAPI:
    app = FastAPI(title="AuraQC Backend")
    app.openapi = lambda: build_openapi_schema(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS or ["http://localhost:5173"],
        allow_credentials=ALLOW_CREDENTIALS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.middleware("http")(add_request_id)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(AgentRuntimeError, agent_runtime_exception_handler)
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.on_event("startup")(on_startup)

    for router in (
        auth_router,
        dashboard_router,
        clusters_router,
        tickets_router,
        todos_router,
        investigate_router,
        admin_router,
    ):
        app.include_router(router)
    return app


app = create_app()


from backend.auth.jwt_utils import get_current_user, require_role  # noqa: E402
from backend.db.session import get_db  # noqa: E402


@app.post("/api/traceability/seed")
def seed_traceability(
    request: Request,
    user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    try:
        result = _seed_traceability_graph(db)
    except Exception as exc:
        db.rollback()
        logger.exception("Traceability seed failed")
        raise HTTPException(status_code=500, detail=f"Traceability seed failed: {exc.__class__.__name__}") from exc
    append_audit_entry(
        {
            "request_id": getattr(request.state, "request_id", None),
            "user_id": user.get("email") or user.get("id"),
            "endpoint": "/api/traceability/seed",
            "mode": "traceability",
            "status": "success",
            "cluster_id": None,
            "traceability_nodes_created": result["nodes_created"],
            "traceability_edges_created": result["edges_created"],
        }
    )
    return result


@app.get("/api/traceability/nodes")
def list_traceability_nodes(
    type: str | None = None,
    status: str | None = None,
    cluster_id: str | None = None,
    search: str | None = None,
    _: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    query = db.query(TraceabilityNode)
    if type:
        query = query.filter(TraceabilityNode.type == _normalize_traceability_type(type))
    if status:
        query = query.filter(TraceabilityNode.status == _normalize_traceability_status(status))
    if cluster_id:
        query = query.filter(TraceabilityNode.cluster_id == cluster_id)
    if search:
        normalized = f"%{search.strip().lower()}%"
        query = query.filter(
            text(
                "lower(coalesce(name, '')) like :search "
                "or lower(coalesce(sku, '')) like :search "
                "or lower(coalesce(location, '')) like :search "
                "or lower(coalesce(supplier, '')) like :search "
                "or lower(coalesce(batch_number, '')) like :search"
            )
        ).params(search=normalized)
    nodes = query.order_by(TraceabilityNode.type.asc(), TraceabilityNode.name.asc()).all()
    return [_serialize_traceability_node(node) for node in nodes]


@app.get("/api/traceability/nodes/{node_id}")
def get_traceability_node(
    node_id: str,
    _: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    node = db.get(TraceabilityNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Traceability node not found")
    upstream_edges = db.query(TraceabilityEdge).filter(TraceabilityEdge.target_id == node_id).all()
    downstream_edges = db.query(TraceabilityEdge).filter(TraceabilityEdge.source_id == node_id).all()
    related_ids = {
        edge.source_id for edge in upstream_edges
    } | {
        edge.target_id for edge in downstream_edges
    }
    related_nodes = (
        db.query(TraceabilityNode).filter(TraceabilityNode.id.in_(related_ids)).all()
        if related_ids
        else []
    )
    by_id = {item.id: item for item in related_nodes}
    payload = _serialize_traceability_node(node)
    payload.update(
        {
            "edges": [_serialize_traceability_edge(edge) for edge in [*upstream_edges, *downstream_edges]],
            "upstream_nodes": [_serialize_traceability_node(by_id[edge.source_id]) for edge in upstream_edges if edge.source_id in by_id],
            "downstream_nodes": [_serialize_traceability_node(by_id[edge.target_id]) for edge in downstream_edges if edge.target_id in by_id],
        }
    )
    return payload


@app.get("/api/traceability/graph")
def get_traceability_graph(
    _: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    nodes = db.query(TraceabilityNode).order_by(TraceabilityNode.type.asc(), TraceabilityNode.name.asc()).all()
    edges = db.query(TraceabilityEdge).order_by(TraceabilityEdge.created_at.asc()).all()
    serialized_nodes = [_serialize_traceability_node(node) for node in nodes]
    columns = {"raw_material": [], "assembly_unit": [], "finished_good": []}
    for node in serialized_nodes:
        columns.setdefault(node["type"], []).append(node)
    return {
        "nodes": serialized_nodes,
        "edges": [_serialize_traceability_edge(edge) for edge in edges],
        "columns": columns,
    }


@app.post("/api/traceability/nodes")
def create_traceability_node(
    req: TraceabilityNodeCreateRequest,
    request: Request,
    user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    node_type = _normalize_traceability_type(req.type)
    node = TraceabilityNode(
        id=f"node-{uuid.uuid4()}",
        name=req.name.strip(),
        type=node_type,
        sku=req.sku,
        location=req.location,
        supplier=req.supplier,
        batch_number=req.batch_number,
        risk_score=max(0.0, min(1.0, float(req.risk_score or 0.0))),
        status="active",
        cluster_id=req.cluster_id,
        metadata_json=json.dumps({"created_by": user.get("email") or user.get("id")}),
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    append_audit_entry(
        {
            "request_id": getattr(request.state, "request_id", None),
            "user_id": user.get("email") or user.get("id"),
            "endpoint": "/api/traceability/nodes",
            "mode": "traceability",
            "status": "success",
            "cluster_id": req.cluster_id,
            "traceability_node_id": node.id,
        }
    )
    return _serialize_traceability_node(node)


@app.patch("/api/traceability/nodes/{node_id}/status")
def update_traceability_node_status(
    node_id: str,
    req: TraceabilityStatusUpdateRequest,
    request: Request,
    user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    node = db.get(TraceabilityNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Traceability node not found")
    node.status = _normalize_traceability_status(req.status)
    db.commit()
    db.refresh(node)
    append_audit_entry(
        {
            "request_id": getattr(request.state, "request_id", None),
            "user_id": user.get("email") or user.get("id"),
            "endpoint": f"/api/traceability/nodes/{node_id}/status",
            "mode": "traceability",
            "status": "success",
            "cluster_id": node.cluster_id,
            "traceability_node_id": node.id,
            "traceability_status": node.status,
        }
    )
    return _serialize_traceability_node(node)


@app.post("/api/traceability/nodes/{node_id}/contain")
def contain_traceability_node(
    node_id: str,
    req: TraceabilityContainRequest,
    request: Request,
    user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    node = db.get(TraceabilityNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Traceability node not found")
    metadata = _traceability_metadata(node.metadata_json)
    metadata["containment"] = {
        "actions": req.actions,
        "notes": req.notes,
        "contained_at": datetime.utcnow().isoformat(),
        "contained_by": user.get("email") or user.get("id"),
    }
    node.status = "contained"
    node.metadata_json = json.dumps(metadata)
    db.commit()
    db.refresh(node)
    append_audit_entry(
        {
            "request_id": getattr(request.state, "request_id", None),
            "user_id": user.get("email") or user.get("id"),
            "endpoint": f"/api/traceability/nodes/{node_id}/contain",
            "mode": "traceability",
            "status": "success",
            "cluster_id": node.cluster_id,
            "traceability_node_id": node.id,
            "traceability_actions": req.actions,
            "traceability_notes": req.notes,
        }
    )
    return _serialize_traceability_node(node)


@app.get("/api/traceability/impact/{node_id}")
def get_traceability_impact(
    node_id: str,
    _: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    node = db.get(TraceabilityNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Traceability node not found")
    return _build_impact_payload(node, db)


@app.post("/api/traceability/export")
def export_traceability_data(
    req: TraceabilityExportRequest,
    _: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    export_format = str(req.format or "json").strip().lower()
    if export_format not in {"json", "csv"}:
        raise HTTPException(status_code=422, detail="Unsupported export format")

    if req.node_id:
        node = db.get(TraceabilityNode, req.node_id)
        if node is None:
            raise HTTPException(status_code=404, detail="Traceability node not found")
        nodes, edges = _build_connected_subgraph(req.node_id, db)
    else:
        nodes = db.query(TraceabilityNode).all()
        edges = db.query(TraceabilityEdge).all()

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "node_id": req.node_id,
        "nodes": [_serialize_traceability_node(node) for node in nodes],
        "edges": [_serialize_traceability_edge(edge) for edge in edges],
    }
    if export_format == "json":
        return payload

    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=["id", "name", "type", "sku", "location", "supplier", "batch_number", "risk_score", "status", "cluster_id"],
    )
    writer.writeheader()
    for node in payload["nodes"]:
        writer.writerow(
            {
                "id": node["id"],
                "name": node["name"],
                "type": node["type"],
                "sku": node["sku"],
                "location": node["location"],
                "supplier": node["supplier"],
                "batch_number": node["batch_number"],
                "risk_score": node["risk_score"],
                "status": node["status"],
                "cluster_id": node["cluster_id"],
            }
        )
    return {"format": "csv", "content": buffer.getvalue(), "node_id": req.node_id}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD", "false").lower() == "true",
    )
