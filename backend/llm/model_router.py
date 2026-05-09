"""
Model routing layer for task-specific Ollama model selection.

Maps abstract task types to concrete Ollama model names.
Allows frontend/pages to request specialized models for different RCA analysis phases.
"""

import os

try:
    from backend.env_loader import load_backend_env
except ImportError:
    from backend.env_loader import load_backend_env

load_backend_env()

# Task type -> Ollama model name mapping
TASK_TYPE_MODEL_MAP = {
    # Primary RCA analysis
    "rca": os.getenv("OLLAMA_MODEL_RCA", os.getenv("OLLAMA_MODEL", "llama3.2")),
    # Hypothesis generation and evaluation
    "hypothesis": os.getenv("OLLAMA_MODEL_HYPOTHESIS", os.getenv("OLLAMA_MODEL", "llama3.2")),
    # Citation extraction and evidence grounding
    "citations": os.getenv("OLLAMA_MODEL_CITATIONS", os.getenv("OLLAMA_MODEL", "llama3.2")),
    # Anti-gravity challenge (alternative viewpoints)
    "challenge": os.getenv("OLLAMA_MODEL_CHALLENGE", os.getenv("OLLAMA_MODEL", "llama3.2")),
}

# Valid task types
VALID_TASK_TYPES = set(TASK_TYPE_MODEL_MAP.keys())

# Default task type when none is specified
DEFAULT_TASK_TYPE = "rca"


def get_model_for_task(task_type: str | None = None) -> str:
    """
    Get the Ollama model name for a given task type.
    
    Args:
        task_type: One of 'rca', 'hypothesis', 'citations', 'challenge'.
                   If None or invalid, defaults to 'rca' model.
    
    Returns:
        The Ollama model name string (e.g., 'auraqc-rca', 'llama3.2', etc.)
    """
    if not task_type or task_type not in VALID_TASK_TYPES:
        task_type = DEFAULT_TASK_TYPE
    
    return TASK_TYPE_MODEL_MAP.get(task_type, TASK_TYPE_MODEL_MAP[DEFAULT_TASK_TYPE])


def is_valid_task_type(task_type: str) -> bool:
    """Check if a task type is valid."""
    return task_type in VALID_TASK_TYPES


def list_available_models() -> dict:
    """Return the full task->model mapping."""
    return TASK_TYPE_MODEL_MAP.copy()
