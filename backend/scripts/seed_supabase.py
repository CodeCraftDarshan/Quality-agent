try:
    from backend.core.database import Base, ComplaintCluster, SessionLocal, engine
    from backend.main import on_startup
except ImportError:
    from backend.core.database import Base, ComplaintCluster, SessionLocal, engine
    from backend.main import on_startup

def seed_supabase():
    print("Initializing Supabase Schema...")
    Base.metadata.create_all(bind=engine)
    print("Schema created.")
    
    db = SessionLocal()
    # Check if data exists
    if db.execute(text("SELECT COUNT(*) FROM complaint_clusters")).scalar_one() == 0:
        print("Injecting sample data...")
        on_startup()
        print("Sample data inserted successfully!")
    else:
        print("Database already contains records. Skipping injection.")
        
    db.close()

if __name__ == "__main__":
    seed_supabase()
