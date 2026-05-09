CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.complaint_clusters (
    cluster_id VARCHAR PRIMARY KEY,
    title VARCHAR,
    sku VARCHAR,
    defect_family VARCHAR,
    count INTEGER,
    first_seen VARCHAR,
    last_seen VARCHAR,
    confidence DOUBLE PRECISION,
    severity VARCHAR,
    ai_summary TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR
);

CREATE TABLE IF NOT EXISTS public.investigation_tickets (
    ticket_id VARCHAR PRIMARY KEY,
    cluster_id VARCHAR NOT NULL REFERENCES public.complaint_clusters(cluster_id) ON DELETE CASCADE,
    timestamp VARCHAR,
    content TEXT,
    severity VARCHAR,
    associated_sku VARCHAR,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR
);

CREATE TABLE IF NOT EXISTS public.todo_items (
    id BIGSERIAL PRIMARY KEY,
    cluster_id VARCHAR NOT NULL REFERENCES public.complaint_clusters(cluster_id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.resolution_records (
    cluster_id VARCHAR PRIMARY KEY REFERENCES public.complaint_clusters(cluster_id) ON DELETE CASCADE,
    draft_text TEXT NOT NULL DEFAULT '',
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    challenge_notes TEXT,
    log_items_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.complaint_clusters
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR;

ALTER TABLE public.investigation_tickets
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR;

ALTER TABLE public.todo_items
    ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.resolution_records
    ADD COLUMN IF NOT EXISTS draft_text TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS challenge_notes TEXT,
    ADD COLUMN IF NOT EXISTS log_items_json TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_complaint_clusters_cluster_id
    ON public.complaint_clusters(cluster_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_investigation_tickets_ticket_id
    ON public.investigation_tickets(ticket_id);

CREATE INDEX IF NOT EXISTS idx_investigation_tickets_cluster_id
    ON public.investigation_tickets(cluster_id);

CREATE INDEX IF NOT EXISTS idx_todo_items_cluster_id
    ON public.todo_items(cluster_id);

CREATE INDEX IF NOT EXISTS idx_todo_items_cluster_status
    ON public.todo_items(cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_resolution_records_cluster_id
    ON public.resolution_records(cluster_id);

DROP TRIGGER IF EXISTS trg_complaint_clusters_updated_at ON public.complaint_clusters;
CREATE TRIGGER trg_complaint_clusters_updated_at
BEFORE UPDATE ON public.complaint_clusters
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_investigation_tickets_updated_at ON public.investigation_tickets;
CREATE TRIGGER trg_investigation_tickets_updated_at
BEFORE UPDATE ON public.investigation_tickets
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_resolution_records_updated_at ON public.resolution_records;
CREATE TRIGGER trg_resolution_records_updated_at
BEFORE UPDATE ON public.resolution_records
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.complaint_clusters REPLICA IDENTITY FULL;
ALTER TABLE public.investigation_tickets REPLICA IDENTITY FULL;
ALTER TABLE public.todo_items REPLICA IDENTITY FULL;
ALTER TABLE public.resolution_records REPLICA IDENTITY FULL;

ALTER TABLE public.complaint_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resolution_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'complaint_clusters'
          AND policyname = 'authenticated_read_complaint_clusters'
    ) THEN
        CREATE POLICY authenticated_read_complaint_clusters
            ON public.complaint_clusters
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'investigation_tickets'
          AND policyname = 'authenticated_read_investigation_tickets'
    ) THEN
        CREATE POLICY authenticated_read_investigation_tickets
            ON public.investigation_tickets
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'todo_items'
          AND policyname = 'authenticated_read_todo_items'
    ) THEN
        CREATE POLICY authenticated_read_todo_items
            ON public.todo_items
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'resolution_records'
          AND policyname = 'authenticated_read_resolution_records'
    ) THEN
        CREATE POLICY authenticated_read_resolution_records
            ON public.resolution_records
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'complaint_clusters'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.complaint_clusters;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'investigation_tickets'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.investigation_tickets;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'todo_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_items;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'resolution_records'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.resolution_records;
    END IF;
END
$$;
