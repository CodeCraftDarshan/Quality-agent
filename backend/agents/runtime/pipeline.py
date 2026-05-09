from __future__ import annotations

from backend.agents.runtime.contracts import PipelineExecutionPlan, PipelineStage, PipelineStep

RCA_EXECUTION_PLAN = PipelineExecutionPlan(
    name="rca_response_pipeline",
    steps=(
        PipelineStep(PipelineStage.LOAD_CONTEXT, "repository", "Load cluster, tickets, and evidence context."),
        PipelineStep(PipelineStage.BUILD_PROMPT, "orchestrator", "Resolve intent and assemble the prompt contract."),
        PipelineStep(PipelineStage.GENERATE, "llm_gateway", "Generate a response from the selected task model."),
        PipelineStep(PipelineStage.PARSE_RESPONSE, "parser", "Convert model output into structured response sections."),
        PipelineStep(PipelineStage.APPLY_FALLBACK, "fallback", "Switch to deterministic local analysis if generation fails."),
        PipelineStep(PipelineStage.POST_PROCESS, "orchestrator", "Apply intent filtering, confidence scoring, and HITL rules."),
    ),
)

INVESTIGATION_QUESTION_PLAN = PipelineExecutionPlan(
    name="investigation_question_pipeline",
    steps=(
        PipelineStep(PipelineStage.LOAD_CONTEXT, "repository", "Load cluster and ticket context for question generation."),
        PipelineStep(PipelineStage.BUILD_PROMPT, "orchestrator", "Build the bounded investigation-question prompt."),
        PipelineStep(PipelineStage.GENERATE, "llm_gateway", "Generate candidate investigation questions."),
        PipelineStep(PipelineStage.PARSE_RESPONSE, "parser", "Parse and de-duplicate question candidates."),
        PipelineStep(PipelineStage.APPLY_FALLBACK, "fallback", "Backfill missing questions with deterministic prompts."),
    ),
)


def get_rca_execution_plan() -> PipelineExecutionPlan:
    return RCA_EXECUTION_PLAN


def get_investigation_question_plan() -> PipelineExecutionPlan:
    return INVESTIGATION_QUESTION_PLAN
