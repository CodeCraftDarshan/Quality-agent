import unittest
from unittest.mock import patch

from backend.agents.runtime.contracts import AgentContext, ClusterSnapshot, TicketSnapshot
from backend.agents.runtime.service import (
    AgentParseError,
    InvestigationQuestionService,
    InvalidTaskTypeError,
    OllamaUnavailableError,
    RCAAgentService,
)


class FakeRepository:
    def load_cluster_context(self, cluster_id: str, ticket_limit: int = 3):
        return AgentContext(
            cluster=ClusterSnapshot(
                cluster_id=cluster_id,
                title="Foreign Object - Canned Beans",
                sku="CB-15-ORG",
                defect_family="Foreign Object",
                count=12,
                confidence=0.91,
                severity="Critical",
                ai_summary="Recurring issue in production cluster.",
            ),
            tickets=(
                TicketSnapshot(
                    ticket_id="TKT-1",
                    timestamp="Nov 04, 10:22 AM",
                    content="Found metal shard in can.",
                    severity="High",
                    associated_sku="CB-15-ORG",
                ),
            ),
            citations=(
                {"id": "DB-CLUSTER", "source": "Cluster CL-992", "excerpt": "summary"},
                {"id": "DB-TICKETS", "source": "Tickets CL-992", "excerpt": "Found metal shard in can."},
            ),
            db_context="Cluster: Foreign Object - Canned Beans",
            ticket_context="- TKT-1: Found metal shard in can.",
        )


class AgentServiceTests(unittest.TestCase):
    def test_invalid_task_type_is_rejected(self):
        with self.assertRaises(InvalidTaskTypeError):
            RCAAgentService(repository=FakeRepository()).run(
                query="What is happening?",
                cluster_id="CL-992",
                task_type="not-a-task",
                request_id="req-invalid-task",
            )

    @patch("backend.agents.runtime.service.OllamaGateway.generate", side_effect=OllamaUnavailableError("offline"))
    def test_local_analysis_fallback_sets_execution_metadata(self, _mock_generate):
        result = RCAAgentService(repository=FakeRepository()).run(
            query="What is the likely cause?",
            cluster_id="CL-992",
            task_type="rca",
            request_id="req-fallback",
        )
        self.assertEqual(result.response.mode, "local-analysis")
        self.assertTrue(result.response.fallback_used)
        self.assertEqual(result.response.pipeline_name, "rca_response_pipeline")
        self.assertEqual(result.response.task_type_resolved, "rca")
        self.assertIn("load_context", result.response.stage_timings_ms)
        self.assertEqual(result.parse_status, "fallback_local_analysis")

    @patch("backend.agents.runtime.service.OllamaGateway.generate", return_value={"text": "", "model": "demo", "endpoint_used": "/api/chat"})
    def test_malformed_model_output_raises_parse_error(self, _mock_generate):
        with self.assertRaises(AgentParseError):
            RCAAgentService(repository=FakeRepository()).run(
                query="Give me the cause",
                cluster_id="CL-992",
                task_type="rca",
                request_id="req-parse-fail",
            )

    @patch(
        "backend.agents.runtime.service.OllamaGateway.generate",
        return_value={
            "text": "Conclusion: Insufficient data to determine if all complaints are from the same supplier batch.\n\nReasoning Chain:\n- TKT-1 references the affected SKU.\n",
            "model": "demo",
            "endpoint_used": "/api/chat",
        },
    )
    def test_overcautious_summary_is_reframed_into_partial_answer(self, _mock_generate):
        result = RCAAgentService(repository=FakeRepository()).run(
            query="Are all complaints from the same supplier batch?",
            cluster_id="CL-992",
            task_type="rca",
            request_id="req-partial-answer",
        )
        self.assertIn("Available evidence shows", result.response.reply)
        self.assertIn("supplier batch or lot identifiers", result.response.reply)
        self.assertIn("SKU CB-15-ORG", result.response.reply)

    @patch("backend.agents.runtime.service.OllamaGateway.generate", side_effect=OllamaUnavailableError("offline"))
    def test_question_generation_has_deterministic_fallback(self, _mock_generate):
        trace = InvestigationQuestionService(repository=FakeRepository()).generate_with_trace(
            cluster_id="CL-992",
            question_count=4,
        )
        self.assertEqual(len(trace["questions"]), 4)
        self.assertTrue(trace["fallback_used"])
        self.assertEqual(trace["pipeline_name"], "investigation_question_pipeline")
        self.assertIn("apply_fallback", trace["stage_timings_ms"])


if __name__ == "__main__":
    unittest.main()
