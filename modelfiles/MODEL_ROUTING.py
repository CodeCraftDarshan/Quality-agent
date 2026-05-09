# ============================================================
# AuraQC — Model Routing Reference
# Add this to AGENTS.md or agent_v2.py as a routing guide
# ============================================================

"""
MODEL ROUTING — which model to call at each stage of the pipeline

Each model is a separately deployed Ollama instance with a custom Modelfile.
The agent_v2.py (now backend/agent.py after cutover) must route to the
correct model at each pipeline stage using OllamaGateway.

┌─────────────────────────────────────────────────────────────────────────┐
│  Pipeline Stage          │ Env Var                    │ Model Name       │
├─────────────────────────────────────────────────────────────────────────┤
│  Full RCA Copilot Chat   │ OLLAMA_MODEL_RCA           │ auraqc-rca       │
│  Hypothesis Generation   │ OLLAMA_MODEL_HYPOTHESIS    │ auraqc-hypothesis│
│  Citation Extraction     │ OLLAMA_MODEL_CITATIONS     │ auraqc-citations │
│  Anti-Gravity Challenge  │ OLLAMA_MODEL_CHALLENGE     │ auraqc-challenge │
│  Local-Analysis Fallback │ OLLAMA_MODEL_FALLBACK      │ auraqc-fallback  │
└─────────────────────────────────────────────────────────────────────────┘

CALL ORDER in the pipeline:
1. auraqc-hypothesis  → fast hypothesis list from ticket patterns
2. auraqc-citations   → extract evidence fragments per hypothesis
3. auraqc-challenge   → generate counter-argument for top hypothesis
4. auraqc-rca         → final full synthesis (uses outputs of 1-3 as context)

If any of 1-3 fail → skip that step, pass empty value to next step.
If auraqc-rca fails  → call auraqc-fallback instead.

TOKEN BUDGET PER MODEL (approximate, q4_K_M, RTX 4050):
  auraqc-rca         → ~3–7s   (768 tokens max output)
  auraqc-hypothesis  → ~1–2s   (256 tokens max output)
  auraqc-citations   → ~1–2s   (384 tokens max output)
  auraqc-challenge   → ~1–2s   (256 tokens max output)
  auraqc-fallback    → ~0.5–1s (512 tokens, phi3:mini base)

TOTAL PIPELINE TARGET: < 12s end-to-end
SINGLE MODEL (rca only) TARGET: < 7s

ENV VARS TO ADD TO .env.example:
  OLLAMA_MODEL_RCA=auraqc-rca
  OLLAMA_MODEL_HYPOTHESIS=auraqc-hypothesis
  OLLAMA_MODEL_CITATIONS=auraqc-citations
  OLLAMA_MODEL_CHALLENGE=auraqc-challenge
  OLLAMA_MODEL_FALLBACK=auraqc-fallback

IMPLEMENTATION IN OllamaGateway (backend/llm_gateway.py):

  def generate_rca(self, prompt, context):
      return self.generate(prompt, model=os.getenv("OLLAMA_MODEL_RCA"))

  def generate_hypothesis(self, ticket_text):
      return self.generate(ticket_text, model=os.getenv("OLLAMA_MODEL_HYPOTHESIS"))

  def extract_citations(self, claim, ticket_text):
      return self.generate(f"CLAIM: {claim}\n\nTICKETS: {ticket_text}",
                           model=os.getenv("OLLAMA_MODEL_CITATIONS"))

  def generate_challenge(self, hypothesis, evidence):
      return self.generate(f"HYPOTHESIS: {hypothesis}\n\nEVIDENCE: {evidence}",
                           model=os.getenv("OLLAMA_MODEL_CHALLENGE"))

  def generate_fallback(self, ticket_summary):
      return self.generate(ticket_summary, model=os.getenv("OLLAMA_MODEL_FALLBACK"))

NOTES:
- All models run on the same Ollama instance (ollama serve).
  Ollama handles model switching automatically — no port changes needed.
- Ollama loads one model at a time into VRAM by default.
  Set OLLAMA_MAX_LOADED_MODELS=2 in Ollama env if you have RAM headroom.
- If VRAM pressure is high, collapse to single model mode:
  Set OLLAMA_SINGLE_MODEL=true → all calls use OLLAMA_MODEL_RCA only.
"""
