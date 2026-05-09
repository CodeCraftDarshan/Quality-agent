from pathlib import Path

from dotenv import load_dotenv


BACKEND_ENV_PATH = Path(__file__).resolve().with_name(".env")
ROOT_ENV_PATH = BACKEND_ENV_PATH.parent.parent / ".env"


def load_backend_env() -> None:
    """Load shared repo env first, then backend-local env as the override layer."""
    load_dotenv(dotenv_path=ROOT_ENV_PATH, override=False)
    load_dotenv(dotenv_path=BACKEND_ENV_PATH, override=True)
