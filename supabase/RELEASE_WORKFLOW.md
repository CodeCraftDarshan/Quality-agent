# Supabase Migration And Seed Workflow

## Release Artifacts
- Schema migrations live in `supabase/migrations/`
- Baseline seed data lives in `supabase/seed.sql`
- Expanded review and demo data lives in `supabase/seed_extended.sql`

## Local Reset Flow
1. Run `supabase db reset`
2. Apply the baseline seed automatically
3. Apply `seed_extended.sql` when you need the larger operational dataset

## Production-Like Promotion Flow
1. Create a timestamped migration in `supabase/migrations/`
2. Review the migration against existing tables used by the backend service layer
3. Apply the migration to the target Supabase project
4. Run `seed_extended.sql` only when the target environment is intended to hold demo or analyst review data
5. Validate readback in the UI and backend API before sign-off

## Verification Queries
- Confirm cluster count:
  - `select count(*) from public.complaint_clusters;`
- Confirm ticket count:
  - `select count(*) from public.investigation_tickets;`
- Confirm execution audit table exists:
  - `select count(*) from public.agent_execution_records;`

## Operational Rule
Treat migrations and seeds as release inputs owned by the repo. Do not rely on one-off SQL pasted outside version control for production changes.
