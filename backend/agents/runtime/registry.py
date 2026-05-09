from __future__ import annotations

from dataclasses import dataclass

from backend.agents.runtime.contracts import AgentContribution, AgentContext, AgentName, AgentRoute, EvidencePacket, VerificationResult


@dataclass(frozen=True)
class AgentDescriptor:
    name: AgentName
    responsibility: str


class BasePlatformAgent:
    descriptor: AgentDescriptor


class EvidenceAgent(BasePlatformAgent):
    descriptor = AgentDescriptor(
        name=AgentName.EVIDENCE,
        responsibility="Normalize cluster and ticket evidence into a reusable packet.",
    )

    def collect(self, context: AgentContext) -> EvidencePacket:
        cluster_count = len(getattr(context, "clusters", (context.cluster,)))
        top_ticket_ids = tuple(ticket.ticket_id for ticket in context.tickets[:3] if ticket.ticket_id)
        primary_label = context.cluster.cluster_id
        signals = tuple(
            filter(
                None,
                [
                    f"Combined investigation spans {cluster_count} clusters." if cluster_count > 1 else None,
                    f"Primary cluster is {primary_label}.",
                    f"Cluster severity is {context.cluster.severity or 'unknown'}.",
                    f"Defect family is {context.cluster.defect_family or 'unclassified'}.",
                    f"Observed across {context.cluster.count} related complaints.",
                ],
            )
        )
        return EvidencePacket(
            cluster_id=context.cluster.cluster_id,
            summary=context.cluster.ai_summary or context.cluster.title or context.cluster.cluster_id,
            db_context=context.db_context,
            ticket_context=context.ticket_context,
            citations=context.citations,
            top_ticket_ids=top_ticket_ids,
            signals=signals,
        )


class HypothesisAgent(BasePlatformAgent):
    descriptor = AgentDescriptor(
        name=AgentName.HYPOTHESIS,
        responsibility="Focus the response on likely causes supported by evidence.",
    )

    def contribute(self, evidence: EvidencePacket, query: str) -> AgentContribution:
        ticket_hint = ", ".join(evidence.top_ticket_ids) if evidence.top_ticket_ids else "cluster evidence"
        return AgentContribution(
            agent_name=self.descriptor.name,
            prompt_fragment=(
                "Hypothesis Agent Instruction:\n"
                f"- Prioritize the most evidence-backed cause for the user's question.\n"
                f"- Use concrete references from {ticket_hint} when possible.\n"
                "- If alternate causes exist, rank them below the lead hypothesis.\n"
            ),
            reasoning_focus=evidence.signals,
        )


class ChallengeAgent(BasePlatformAgent):
    descriptor = AgentDescriptor(
        name=AgentName.CHALLENGE,
        responsibility="Generate counter-hypotheses and disconfirming paths.",
    )

    def contribute(self, evidence: EvidencePacket, query: str) -> AgentContribution:
        return AgentContribution(
            agent_name=self.descriptor.name,
            prompt_fragment=(
                "Challenge Agent Instruction:\n"
                "- Surface a plausible counter-explanation that would disprove the default theory.\n"
                "- Prefer downstream handling, packaging, storage, or interpretation risks when evidence supports them.\n"
            ),
            reasoning_focus=evidence.signals,
        )


class ActionPlanAgent(BasePlatformAgent):
    descriptor = AgentDescriptor(
        name=AgentName.ACTION_PLAN,
        responsibility="Generate concrete next actions for containment and verification.",
    )

    def contribute(self, evidence: EvidencePacket, query: str) -> AgentContribution:
        return AgentContribution(
            agent_name=self.descriptor.name,
            prompt_fragment=(
                "Action Plan Agent Instruction:\n"
                "- Recommend specific, evidence-backed actions.\n"
                "- Prioritize containment, verification, and owner-ready follow-up steps.\n"
            ),
            reasoning_focus=evidence.signals,
        )


class VerifierAgent(BasePlatformAgent):
    descriptor = AgentDescriptor(
        name=AgentName.VERIFIER,
        responsibility="Validate final response quality and identify verification gaps.",
    )

    def verify(self, response_payload: dict) -> VerificationResult:
        reasons: list[str] = []
        if not response_payload.get("reply"):
            reasons.append("missing_reply")
        if not response_payload.get("citations"):
            reasons.append("missing_citations")
        if not any(
            response_payload.get(key)
            for key in ("hypotheses", "reasoning_chain", "next_actions", "anti_gravity_challenge")
        ):
            reasons.append("missing_structured_support")
        return VerificationResult(
            verified=len(reasons) == 0,
            status="verified" if len(reasons) == 0 else "needs_review",
            reasons=tuple(reasons),
        )


class OrchestratorAgent(BasePlatformAgent):
    descriptor = AgentDescriptor(
        name=AgentName.ORCHESTRATOR,
        responsibility="Select the agent route for the request and compose the final plan.",
    )

    def plan_route(self, intent: str) -> AgentRoute:
        if intent == "hypothesis":
            agents = (AgentName.EVIDENCE, AgentName.HYPOTHESIS, AgentName.VERIFIER)
        elif intent == "challenge":
            agents = (AgentName.EVIDENCE, AgentName.CHALLENGE, AgentName.VERIFIER)
        elif intent == "actions":
            agents = (AgentName.EVIDENCE, AgentName.ACTION_PLAN, AgentName.VERIFIER)
        elif intent == "reasoning":
            agents = (AgentName.EVIDENCE, AgentName.HYPOTHESIS, AgentName.VERIFIER)
        elif intent == "summary":
            agents = (AgentName.EVIDENCE, AgentName.VERIFIER)
        else:
            agents = (
                AgentName.EVIDENCE,
                AgentName.HYPOTHESIS,
                AgentName.CHALLENGE,
                AgentName.ACTION_PLAN,
                AgentName.VERIFIER,
            )
        return AgentRoute(intent=intent, agents=agents)


class AgentRegistry:
    def __init__(self):
        self._agents = {
            AgentName.ORCHESTRATOR: OrchestratorAgent(),
            AgentName.EVIDENCE: EvidenceAgent(),
            AgentName.HYPOTHESIS: HypothesisAgent(),
            AgentName.CHALLENGE: ChallengeAgent(),
            AgentName.ACTION_PLAN: ActionPlanAgent(),
            AgentName.VERIFIER: VerifierAgent(),
        }

    def get(self, agent_name: AgentName | str):
        normalized_name = agent_name if isinstance(agent_name, AgentName) else AgentName(str(agent_name))
        return self._agents[normalized_name]

    def list_descriptors(self) -> list[AgentDescriptor]:
        return [agent.descriptor for agent in self._agents.values()]
