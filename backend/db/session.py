from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.core.config import HAS_REAL_SUPABASE_URL, SQLITE_DATABASE_URL, SUPABASE_DATABASE_URL
from backend.db.models import Base

if HAS_REAL_SUPABASE_URL:
    try:
        candidate_engine = create_engine(
            SUPABASE_DATABASE_URL,
            pool_size=5,
            max_overflow=2,
            pool_timeout=10,
            pool_pre_ping=True,
            pool_recycle=300,
        )
        with candidate_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine = candidate_engine
    except Exception as exc:
        print(f"WARNING: Could not connect using SUPABASE_DATABASE_URL ({exc}). Falling back to local SQLite.")
        engine = create_engine(SQLITE_DATABASE_URL, connect_args={"check_same_thread": False}, pool_pre_ping=True)
else:
    print("WARNING: SUPABASE_DATABASE_URL not configured. Falling back to local SQLite.")
    engine = create_engine(SQLITE_DATABASE_URL, connect_args={"check_same_thread": False}, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as db:
        try:
            db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS traceability_nodes (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL,
                      type TEXT NOT NULL,
                      sku TEXT,
                      location TEXT,
                      supplier TEXT,
                      batch_number TEXT,
                      risk_score REAL DEFAULT 0.0,
                      status TEXT DEFAULT 'active',
                      cluster_id TEXT,
                      created_at TEXT,
                      metadata_json TEXT
                    )
                    """
                )
            )
        except Exception:
            pass
        try:
            db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS traceability_edges (
                      id TEXT PRIMARY KEY,
                      source_id TEXT NOT NULL,
                      target_id TEXT NOT NULL,
                      relationship TEXT DEFAULT 'supplies',
                      created_at TEXT
                    )
                    """
                )
            )
        except Exception:
            pass
        try:
            db.execute(text("ALTER TABLE complaint_clusters ADD COLUMN status TEXT DEFAULT 'open'"))
        except Exception:
            pass
        try:
            db.execute(text("ALTER TABLE complaint_clusters ADD COLUMN resolved_at TEXT"))
        except Exception:
            pass
        try:
            db.execute(text("ALTER TABLE complaint_clusters ADD COLUMN resolution_notes TEXT"))
        except Exception:
            pass
