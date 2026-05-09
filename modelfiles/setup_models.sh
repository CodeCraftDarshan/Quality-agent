#!/bin/bash
# ============================================================
# AuraQC — Ollama Model Setup Script
# Run this once to pull base models and build all custom models
# Usage: bash setup_models.sh
# ============================================================

set -e

echo "==> Pulling base models..."
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull phi3:mini

echo ""
echo "==> Building AuraQC custom models from Modelfiles..."

ollama create auraqc-rca        -f modelfiles/Modelfile.rca_copilot
ollama create auraqc-hypothesis -f modelfiles/Modelfile.hypothesis
ollama create auraqc-citations  -f modelfiles/Modelfile.citations
ollama create auraqc-challenge  -f modelfiles/Modelfile.challenge
ollama create auraqc-fallback   -f modelfiles/Modelfile.fallback

echo ""
echo "==> Verifying models registered..."
ollama list | grep auraqc

echo ""
echo "==> Done. Update your .env:"
echo "  OLLAMA_MODEL_RCA=auraqc-rca"
echo "  OLLAMA_MODEL_HYPOTHESIS=auraqc-hypothesis"
echo "  OLLAMA_MODEL_CITATIONS=auraqc-citations"
echo "  OLLAMA_MODEL_CHALLENGE=auraqc-challenge"
echo "  OLLAMA_MODEL_FALLBACK=auraqc-fallback"
