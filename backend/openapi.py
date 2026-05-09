from __future__ import annotations

from fastapi.openapi.utils import get_openapi


def build_openapi_schema(app):
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title="AuraQC Backend",
        version="3.1.0",
        description="AuraQC RCA Copilot API",
        routes=app.routes,
    )
    schema["openapi"] = "3.1.0"

    components = schema.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    schemas["ChatRequest"] = {
        "type": "object",
        "required": ["message", "cluster_id"],
        "properties": {
            "message": {"type": "string"},
            "cluster_id": {"type": "string"},
            "task_type": {
                "type": "string",
                "enum": ["rca", "hypothesis", "citations", "challenge"],
                "description": "Task type for model selection. Defaults to 'rca' if not specified.",
            },
        },
    }
    schemas["ChatResponse"] = {
        "type": "object",
        "properties": {
            "reply": {"type": "string"},
            "citations": {"type": "array", "items": {"type": "object"}},
            "hypotheses": {"type": "array", "items": {"type": "object"}},
            "reasoning_chain": {"type": "array", "items": {"type": "string"}},
            "anti_gravity_challenge": {"type": ["string", "null"]},
            "next_actions": {"type": "array", "items": {"type": "string"}},
            "model": {"type": "string"},
            "mode": {"type": "string"},
            "timing_ms": {"type": "integer"},
            "request_id": {"type": "string"},
            "confidence": {"type": "number"},
            "hitl_flagged": {"type": "boolean"},
            "hitl_reasons": {"type": "array", "items": {"type": "string"}},
            "pipeline_name": {"type": ["string", "null"]},
            "fallback_used": {"type": "boolean"},
            "stage_timings_ms": {"type": "object", "additionalProperties": {"type": "integer"}},
            "task_type_resolved": {"type": ["string", "null"]},
        },
    }
    schemas["ErrorResponse"] = {
        "type": "object",
        "properties": {
            "error_code": {"type": "string"},
            "message": {"type": "string"},
            "request_id": {"type": "string"},
        },
    }
    schemas["ErrorCodeCatalog"] = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "error_code": {"type": "string"},
                "http_status": {"type": "integer"},
                "meaning": {"type": "string"},
            },
        },
        "example": [
            {"error_code": "RCA_001", "http_status": 502, "meaning": "Ollama unavailable"},
            {"error_code": "RCA_002", "http_status": 502, "meaning": "All Ollama endpoints failed"},
            {"error_code": "RCA_003", "http_status": 429, "meaning": "Rate limit exceeded"},
             {"error_code": "RCA_004", "http_status": 401, "meaning": "Invalid or missing auth token"},
             {"error_code": "RCA_005", "http_status": 422, "meaning": "Malformed request body"},
             {"error_code": "RCA_006", "http_status": 404, "meaning": "Cluster not found"},
             {"error_code": "RCA_008", "http_status": 422, "meaning": "Invalid task type"},
             {"error_code": "RCA_009", "http_status": 502, "meaning": "Model response parsing failed"},
         ],
     }

    bearer_auth = {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
    components.setdefault("securitySchemes", {})["BearerAuth"] = bearer_auth

    response_headers = {
        "X-Copilot-Mode": {"schema": {"type": "string"}},
        "X-Copilot-Latency-Ms": {"schema": {"type": "string"}},
        "X-Request-ID": {"schema": {"type": "string"}},
    }
    error_responses = {
        "400": {"description": "Bad Request", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
        "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
        "422": {"description": "Validation Error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
        "429": {"description": "Rate Limited", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
        "502": {"description": "Bad Gateway", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
        "503": {"description": "Service Unavailable", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}},
    }

    for path in ["/api/chat", "/api/chat-ollama", "/api/v2/chat"]:
        if path in schema.get("paths", {}):
            schema["paths"][path]["post"].update(
                {
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ChatRequest"}}},
                    },
                    "responses": {
                        "200": {
                            "description": "Chat response",
                            "headers": response_headers,
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ChatResponse"}}},
                        },
                        **error_responses,
                    },
                    "security": [{"BearerAuth": []}],
                }
            )

    for path in ["/api/dashboard/stats", "/api/clusters", "/api/clusters/{cluster_id}", "/api/tickets", "/api/prompts", "/api/models", "/api/audit", "/api/finops/usage", "/api/risks", "/api/risks/{risk_id}"]:
        if path in schema.get("paths", {}):
            for method in schema["paths"][path].values():
                method["security"] = [{"BearerAuth": []}]

    app.openapi_schema = schema
    return app.openapi_schema
