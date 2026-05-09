import unittest

from backend.agents.runtime.contracts import AgentResponse
from backend.agents.runtime.intents import detect_intent, filter_response_by_intent, resolve_intent
from backend.agents.runtime.parsing import parse_agent_reply, parse_investigation_questions
from backend.agents.runtime.pipeline import get_investigation_question_plan, get_rca_execution_plan
from backend.agents.runtime.service import _resolve_task_type


class AgentRuntimeTests(unittest.TestCase):
    def test_rca_pipeline_has_single_source_of_truth(self):
        plan = get_rca_execution_plan()
        self.assertEqual(plan.name, "rca_response_pipeline")
        self.assertEqual(
            [step.stage.value for step in plan.steps],
            [
                "load_context",
                "build_prompt",
                "generate",
                "parse_response",
                "apply_fallback",
                "post_process",
            ],
        )

    def test_investigation_pipeline_is_explicit(self):
        plan = get_investigation_question_plan()
        self.assertEqual(plan.steps[0].owner, "repository")
        self.assertEqual(plan.steps[-1].stage.value, "apply_fallback")

    def test_task_type_overrides_detected_intent(self):
        self.assertEqual(resolve_intent("summarize this cluster", "challenge"), "challenge")
        self.assertEqual(detect_intent("what should we do next?"), "actions")

    def test_response_filtering_preserves_summary_contract(self):
        response = AgentResponse(
            reply="Summary",
            hypotheses=[{"title": "Lead", "confidence": 0.8}],
            reasoning_chain=["Because"],
            anti_gravity_challenge="Counter",
            next_actions=["Act"],
            citations=[],
            model="x",
            timing_ms=10,
        )
        filtered = filter_response_by_intent(response, "summary")
        self.assertEqual(filtered.reply, "Summary")
        self.assertEqual(filtered.hypotheses, [])
        self.assertEqual(filtered.reasoning_chain, [])
        self.assertEqual(filtered.next_actions, [])
        self.assertIsNone(filtered.anti_gravity_challenge)

    def test_reply_parser_extracts_structured_sections(self):
        parsed = parse_agent_reply(
            query="What is the cause?",
            reply_text=(
                "Conclusion: Metal contamination most likely originates in the canning line. [DB-CLUSTER]\n\n"
                "Hypotheses:\n"
                "- Conveyor abrasion introduced metal fragments (82%)\n\n"
                "Reasoning Chain:\n"
                "- Tickets repeatedly mention metal shards\n\n"
                "Next Actions:\n"
                "- Inspect the canning conveyor"
            ),
            known_citations=(
                {"id": "DB-CLUSTER", "source": "Cluster CL-992", "excerpt": "summary"},
            ),
        )
        self.assertIn("canning line", parsed.summary)
        self.assertEqual(len(parsed.hypotheses), 1)
        self.assertEqual(parsed.hypotheses[0].confidence, 0.82)
        self.assertEqual(parsed.citations[0].id, "DB-CLUSTER")

    def test_question_parser_deduplicates_and_respects_task_types(self):
        questions = parse_investigation_questions(
            (
                "QUESTION 1 | rca | What production step introduced the defect?\n"
                "QUESTION 2 | challenge | What evidence would disprove the current explanation?\n"
                "QUESTION 3 | challenge | What evidence would disprove the current explanation?\n"
            ),
            question_count=3,
        )
        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[1].task_type, "challenge")

    def test_task_type_validation_rejects_conflicting_intent(self):
        with self.assertRaises(Exception) as ctx:
            _resolve_task_type("generate root cause hypotheses", "challenge")
        self.assertEqual(getattr(ctx.exception, "error_code", None), "RCA_012")


if __name__ == "__main__":
    unittest.main()
