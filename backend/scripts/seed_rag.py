import os
import time

from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec

try:
    from backend.llm.embeddings import embed_query_with_fallback
except ImportError:
    from backend.llm.embeddings import embed_query_with_fallback

load_dotenv()


def _wait_until_index_ready(pc: Pinecone, index_name: str, timeout_seconds: int = 30):
    start = time.time()
    while time.time() - start < timeout_seconds:
        details = pc.describe_index(index_name)
        status = getattr(details, "status", None) or details.get("status", {})
        is_ready = status.get("ready", False) if isinstance(status, dict) else bool(getattr(status, "ready", False))
        if is_ready:
            return
        time.sleep(1)
    raise TimeoutError(f"Index '{index_name}' did not become ready within {timeout_seconds} seconds")


def _recreate_index(pc: Pinecone, index_name: str, dimension: int):
    print(f"Recreating index '{index_name}' with dimension {dimension}...")
    pc.delete_index(index_name)
    # Wait for deletion to propagate.
    for _ in range(30):
        if index_name not in pc.list_indexes().names():
            break
        time.sleep(1)
    else:
        raise TimeoutError(f"Index '{index_name}' was not deleted in time")

    pc.create_index(
        name=index_name,
        dimension=dimension,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    _wait_until_index_ready(pc, index_name)


def seed_pinecone():
    pc_key = os.getenv("PINECONE_API_KEY")
    index_name = os.getenv("PINECONE_INDEX_NAME", "auraqc-sops")

    if not pc_key:
        print("Required API key missing. Please set PINECONE_API_KEY.")
        return

    print(f"Connecting to Pinecone...")
    pc = Pinecone(api_key=pc_key)

    # Mock SOP Documents to embed
    documents = [
        {"id": "sop-442", "text": "Q-SOP-442: If metal fragments are detected in canning lines (especially CB-15-ORG or CB-15-LOW), the Pack-Line must be halted. All pallets from the previous 4 hours must be put on Quarantine Hold in the ERP."},
        {"id": "sop-319", "text": "Q-SOP-319: Sour taste in dairy products indicates early spoilage often linked to temperature abuse in Northeast distribution centers. Inspect transit logs for temperature excursions."},
    ]

    print("Generating embeddings...")

    vectors = []
    selected_model = None
    embedding_dim = None
    for doc in documents:
        vec, used_model, used_dim = embed_query_with_fallback(doc["text"])
        selected_model = selected_model or used_model
        embedding_dim = embedding_dim or used_dim
        vectors.append({
            "id": doc["id"],
            "values": vec,
            "metadata": {"text": doc["text"]}
        })

    print(f"Using embedding model: {selected_model} (dimension={embedding_dim})")

    existing_indexes = pc.list_indexes().names()
    if index_name not in existing_indexes:
        print(f"Creating index '{index_name}'...")
        pc.create_index(
            name=index_name,
            dimension=embedding_dim,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        _wait_until_index_ready(pc, index_name)
    else:
        details = pc.describe_index(index_name)
        current_dim = details.get("dimension") if isinstance(details, dict) else getattr(details, "dimension", None)
        if current_dim != embedding_dim:
            stats = pc.Index(index_name).describe_index_stats()
            total_vectors = stats.get("total_vector_count", 0) if isinstance(stats, dict) else getattr(stats, "total_vector_count", 0)
            if total_vectors == 0:
                _recreate_index(pc, index_name, embedding_dim)
            else:
                raise RuntimeError(
                    f"Index '{index_name}' dimension is {current_dim} but embedding model '{selected_model}' uses {embedding_dim}. "
                    "Create a new index name or clear existing vectors before reseeding."
                )

    index = pc.Index(index_name)
    print(f"Upserting {len(vectors)} vectors to Pinecone...")
    index.upsert(vectors=vectors)
    print("Seeding complete.")

if __name__ == "__main__":
    seed_pinecone()
