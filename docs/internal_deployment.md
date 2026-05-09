# Internal Deployment Guide

## Services
- `backend`: FastAPI application served by `uvicorn` on port `8000`
- `frontend`: Vite-built React app served by `nginx` on port `5173`

## Environment Contracts
- `backend/.env`
  - `SUPABASE_DATABASE_URL`
  - `SUPABASE_PROJECT_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OLLAMA_BASE_URL`
  - `OLLAMA_TIMEOUT_SEC`
  - `ALLOWED_ORIGINS`
- `frontend/.env`
  - `VITE_API_BASE_URL`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## Startup
1. Copy `backend/.env.example` to `backend/.env` and fill real values.
2. Copy `frontend/.env.example` to `frontend/.env` and fill real values.
3. Run `docker compose up --build`.
4. Wait for backend health on `/api/v2/health`.
5. Open the frontend on `http://localhost:5173`.

## Local Development
For Windows local development, prefer the project virtual environment instead of a globally installed `uvicorn`:

1. Create the venv if needed: `py -3.13 -m venv .venv`
2. Install backend dependencies: `.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt`
3. Start the backend: `.\start_backend.ps1`

Using the global `python` or `uvicorn` can fail with missing modules even when the dependency is already installed in `.venv`.
If an install is interrupted and you start seeing version mismatches such as `pydantic` versus `pydantic-core`, rerun `.\.venv\Scripts\python.exe -m pip install --upgrade --force-reinstall -r backend\requirements.txt` before starting the server again.
The local startup script watches only `backend/` so package updates inside `.venv` do not trigger endless reload loops during development.

## Health Surfaces
- Backend health: `GET /api/health`
- Backend v2 health: `GET /api/v2/health`
- Backend metrics: `GET /api/metrics`
- Audit traces: `GET /api/audit`

## Structured Logging
Backend logs are emitted as JSON and include request-scoped metadata such as:
- `request_id`
- `cluster_id`
- `pipeline_name`
- `agent_name`
- `model`
- `fallback_used`
- `timing_ms`

## Live Verification Checklist
1. Confirm clusters load in the dashboard and console logs show successful fetch traces.
2. Open a seeded cluster such as `CL-995` or `CL-1030`.
3. Run an RCA prompt and confirm the response includes `pipeline_name`, `fallback_used`, and `stage_timings_ms`.
4. Confirm `/api/audit` contains `agents_used` and verification metadata for the request.
5. Stop the model endpoint temporarily and verify local fallback still returns a typed response.
