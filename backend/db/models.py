import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Complaint(Base):
    __tablename__ = "complaints"
    complaint_id = Column(String, primary_key=True, index=True)
    text = Column(String)
    defect_type = Column(String)
    sku = Column(String)
    region = Column(String)
    date = Column(String)
    severity = Column(String)


class ComplaintCluster(Base):
    __tablename__ = "complaint_clusters"
    cluster_id = Column(String, primary_key=True, index=True)
    title = Column(String)
    sku = Column(String)
    defect_family = Column(String)
    count = Column(Integer)
    first_seen = Column(String)
    last_seen = Column(String)
    confidence = Column(Float)
    severity = Column(String)
    ai_summary = Column(String)
    status = Column(String, default="open")
    resolved_at = Column(String, nullable=True)
    resolution_notes = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String, nullable=True)


class InvestigationTicket(Base):
    __tablename__ = "investigation_tickets"
    ticket_id = Column(String, primary_key=True, index=True)
    cluster_id = Column(String, index=True)
    timestamp = Column(String)
    content = Column(String)
    severity = Column(String)
    associated_sku = Column(String)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String, nullable=True)


class TraceabilityNode(Base):
    __tablename__ = "traceability_nodes"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    sku = Column(String, nullable=True)
    location = Column(String, nullable=True)
    supplier = Column(String, nullable=True)
    batch_number = Column(String, nullable=True)
    risk_score = Column(Float, default=0.0)
    status = Column(String, default="active")
    cluster_id = Column(String, ForeignKey("complaint_clusters.cluster_id"), nullable=True, index=True)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    metadata_json = Column(Text, nullable=True)


class TraceabilityEdge(Base):
    __tablename__ = "traceability_edges"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    source_id = Column(String, ForeignKey("traceability_nodes.id"), nullable=False, index=True)
    target_id = Column(String, ForeignKey("traceability_nodes.id"), nullable=False, index=True)
    relationship = Column(String, default="supplies")
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())


class TodoItem(Base):
    __tablename__ = "todo_items"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    cluster_id = Column(String, index=True, nullable=False)
    text = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ResolutionRecord(Base):
    __tablename__ = "resolution_records"
    cluster_id = Column(String, primary_key=True, index=True)
    draft_text = Column(Text, nullable=False, default="")
    locked = Column(Boolean, nullable=False, default=False)
    challenge_notes = Column(Text, nullable=True)
    log_items_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AgentExecutionRecord(Base):
    __tablename__ = "agent_execution_records"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    request_id = Column(String, index=True, nullable=False)
    user_id = Column(String, index=True, nullable=True)
    endpoint = Column(String, nullable=True)
    cluster_id = Column(String, index=True, nullable=True)
    task_type_requested = Column(String, nullable=True)
    task_type_resolved = Column(String, nullable=True)
    intent_resolved = Column(String, nullable=True)
    pipeline_name = Column(String, nullable=True)
    prompt_id = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    model = Column(String, nullable=True)
    ollama_endpoint_used = Column(String, nullable=True)
    mode = Column(String, nullable=True)
    status = Column(String, nullable=False, default="success")
    fallback_used = Column(Boolean, nullable=False, default=False)
    fallback_reason = Column(Text, nullable=True)
    parse_status = Column(String, nullable=True)
    error_code = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    timing_ms = Column(Integer, nullable=False, default=0)
    token_estimate = Column(Integer, nullable=False, default=0)
    citations_count = Column(Integer, nullable=False, default=0)
    hitl_flagged = Column(Boolean, nullable=False, default=False)
    retrieval_ids_json = Column(Text, nullable=False, default="[]")
    response_sections_json = Column(Text, nullable=False, default="[]")
    stage_timings_json = Column(Text, nullable=False, default="{}")
    hitl_reasons_json = Column(Text, nullable=False, default="[]")
    raw_payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
