import unittest
from unittest.mock import patch

from backend.agents.runtime.contracts import AgentName, AgentRoute
from backend.agents.runtime.registry import AgentRegistry
from backend.agents.runtime.service import OllamaUnavailableError, RCAAgentService

from backend.tests.test_agent_services import FakeRepository


class AgentPlatformTests(unittest.TestCase):
    def test_registry_exposes_expected_core_agents(self):
        registry = AgentRegistry()
        descriptors = {descriptor.name for descriptor in registry.list_descriptors()}
        self.assertEqual(
            descriptors,
            {
                AgentName.ORCHESTRATOR,
                AgentName.EVIDENCE,
                AgentName.HYPOTHESIS,
                AgentName.CHALLENGE,
                AgentName.ACTION_PLAN,
                AgentName.VERIFIER,
            },
        )

    def test_orchestrator_routes_challenge_requests_to_challenge_agent(self):
        route = AgentRegistry().get(AgentName.ORCHESTRATOR).plan_route("challenge")
        self.assertEqual(
            route,
            AgentRoute(
                intent="challenge",
                agents=(AgentName.EVIDENCE, AgentName.CHALLENGE, AgentName.VERIFIER),
            ),
        )

    def test_orchestrator_routes_full_requests_through_multi_agent_plan(self):
        route = AgentRegistry().get("orchestrator").plan_route("full")
        self.assertEqual(
            route.agents,
            (
                AgentName.EVIDENCE,
                AgentName.HYPOTHESIS,
                AgentName.CHALLENGE,
                AgentName.ACTION_PLAN,
                AgentName.VERIFIER,
            ),
        )

    @patch("backend.agents.runtime.service.OllamaGateway.generate", side_effect=OllamaUnavailableError("offline"))
    def test_rca_execution_captures_agent_route_even_when_generation_fails(self, _mock_generate):
        result = RCAAgentService(repository=FakeRepository()).run(
            query="What is the likely cause?",
            cluster_id="CL-992",
            task_type="rca",
            request_id="req-agent-route-error",
        )
        self.assertEqual(result.route.intent, "full")
        self.assertIn("hypothesis", result.agents_used)
        self.assertIn("challenge", result.agents_used)
        self.assertTrue(result.fallback_used)

    @patch("backend.agents.runtime.service.OllamaGateway.generate", side_effect=OllamaUnavailableError("offline"))
    def test_verifier_marks_local_analysis_response(self, _mock_generate):
        result = RCAAgentService(repository=FakeRepository()).run(
            query="Summarize the issue",
            cluster_id="CL-992",
            task_type="rca",
            request_id="req-verifier-review",
        )
        self.assertEqual(result.route.intent, "full")
        self.assertIn("evidence", result.agents_used)
        self.assertIn("verifier", result.agents_used)
        self.assertIsNotNone(result.verification_result)
        self.assertIn(result.verification_result.status, {"verified", "needs_review"})


if __name__ == "__main__":
    unittest.main()
