# Vercel Deployment (Frontend)

## Scope
- Deploy only `frontend/` to Vercel as a static React app.
- Keep backend running on your Docker host/public tunnel.
- Backend continues calling local Ollama on your machine.

## Vercel Project Settings
- Framework Preset: `Vite`
- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`

## Required Vercel Env Vars
Set in Vercel project for all environments:

- `VITE_API_BASE_URL=https://<your-backend-public-domain>`
- `VITE_SUPABASE_URL=<your-supabase-url>`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>`
- Optional: `VITE_COPILOT_VERSION=v2`

Do not set `VITE_API_BASE_URL` to `localhost` on Vercel.

## Routing
`frontend/vercel.json` is configured to rewrite all unmatched routes to `index.html` so React Router deep links work.

## Backend CORS
In `backend/.env`, include your Vercel domain in `ALLOWED_ORIGINS`, for example:

```env
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173,http://127.0.0.1:5173
```

Then restart backend:

```powershell
docker compose up -d backend
```

## Important Runtime Note
If your backend URL is a temporary `trycloudflare.com` URL, it changes when tunnel restarts. You must update `VITE_API_BASE_URL` in Vercel each time.

For stable Vercel production, use a named Cloudflare Tunnel/domain for backend.
