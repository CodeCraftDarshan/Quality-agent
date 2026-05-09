import hashlib
import math
from functools import lru_cache

EMBEDDING_DIMENSION = 64
EMBEDDING_MODEL_NAME = "local-hash-embedding-v1"


def embedding_model_candidates() -> list[str]:
    return [EMBEDDING_MODEL_NAME]


@lru_cache(maxsize=1024)
def _embed_text(text: str) -> tuple[float, ...]:
    normalized = " ".join((text or "").lower().split())
    if not normalized:
        return tuple(0.0 for _ in range(EMBEDDING_DIMENSION))

    values = [0.0] * EMBEDDING_DIMENSION
    for token in normalized.split():
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        for idx in range(EMBEDDING_DIMENSION):
            byte = digest[idx % len(digest)]
            values[idx] += (byte / 255.0) * 2.0 - 1.0

    magnitude = math.sqrt(sum(value * value for value in values)) or 1.0
    return tuple(round(value / magnitude, 6) for value in values)


def embed_query_with_fallback(text: str, _unused_key: str | None = None) -> tuple[list[float], str, int]:
    vector = list(_embed_text(text or ""))
    return vector, EMBEDDING_MODEL_NAME, EMBEDDING_DIMENSION
