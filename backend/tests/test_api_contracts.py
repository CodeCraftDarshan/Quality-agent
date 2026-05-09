import uuid
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.agents.runtime.contracts import AgentExecutionResult, AgentResponse
from backend.db.session import init_db
from backend.utils.audit import read_audit_entries
from backend.main import app, get_current_user


def _build_execution_result(request_id: str) -> AgentExecutionResult:
    response = AgentResponse(
        reply="Metal contamination likely originated in the canning line.",
        citations=[{"id": "DB-CLUSTER", "source": "Cluster CL-992", "excerpt": "summary"}],
        hypotheses=[{"title": "Conveyor abrasion introduced fragments", "confidence": 0.82}],
        reasoning_chain=["Tickets repeatedly mention metal shards."],
        anti_gravity_challenge="If retained samples are clean, the complaint grouping may be too broad.",
        next_actions=["Inspect the canning conveyor."],
        model="auraqc-rca",
        mode="ollama",
        timing_ms=42,
        confidence=0.88,
        hitl_flagged=False,
        hitl_reasons=[],
        pipeline_name="rca_response_pipeline",
        fallback_used=False,
        stage_timings_ms={"load_context": 2, "build_prompt": 3, "generate": 20, "parse_response": 4, "apply_fallback": 0, "post_process": 5},
        task_type_resolved="rca",
    )
    return AgentExecutionResult(
        response=response,
        request_id=request_id,
        cluster_id="CL-992",
        task_type_requested="rca",
        task_type_resolved="rca",
        intent_resolved="full",
        pipeline_name="rca_response_pipeline",
        prompt_id="rca_system_v1",
        prompt_version="2.0.0",
        selected_model="auraqc-rca",
        gateway_endpoint_used="/api/chat",
        stage_timings_ms=response.stage_timings_ms,
        fallback_used=False,
        fallback_reason=None,
        parse_status="structured",
        status="success",
    )


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)
        app.dependency_overrides[get_current_user] = lambda: {
            "id": "test-user",
            "email": "test@example.com",
            "role": "authenticated",
        }

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()

    @patch("backend.services.chat_service.RCAAgentService.run")
    def test_chat_response_keeps_backward_compatible_shape_and_new_metadata(self, mock_run):
        request_id = f"test-{uuid.uuid4()}"
        mock_run.return_value = _build_execution_result(request_id)
        res = self.client.post(
            "/api/chat",
            json={"message": "What is the likely cause?", "cluster_id": "CL-992", "task_type": "rca"},
            headers={"x-request-id": request_id},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        for field in [
            "reply",
            "hypotheses",
            "reasoning_chain",
            "next_actions",
            "anti_gravity_challenge",
            "citations",
            "mode",
            "model",
            "timing_ms",
            "confidence",
            "hitl_flagged",
            "hitl_reasons",
            "pipeline_name",
            "fallback_used",
            "stage_timings_ms",
            "task_type_resolved",
        ]:
            self.assertIn(field, body)
        audit_entries = read_audit_entries(limit=20, user_id="test-user")
        matching = [entry for entry in audit_entries if entry.get("request_id") == request_id]
        self.assertTrue(matching)
        self.assertEqual(matching[0].get("pipeline_name"), "rca_response_pipeline")

    def test_invalid_request_body_returns_standard_error(self):
        res = self.client.post("/api/chat", json={"message": "Missing cluster id"})
        self.assertEqual(res.status_code, 422)
        body = res.json()
        self.assertEqual(body["error_code"], "RCA_005")
        self.assertIn("cluster_id", body["message"])

    def test_auth_protected_endpoint_returns_standard_error(self):
        app.dependency_overrides[get_current_user] = lambda: (_ for _ in ()).throw(
            HTTPException(status_code=401, detail="Missing bearer token")
        )
        res = self.client.get("/api/clusters")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["error_code"], "AUTH_001")

    def test_cluster_not_found_is_typed(self):
        res = self.client.post(
            "/api/chat",
            json={"message": "What is the likely cause?", "cluster_id": "CL-404", "task_type": "rca"},
        )
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()["error_code"], "RCA_006")


if __name__ == "__main__":
    unittest.main()
