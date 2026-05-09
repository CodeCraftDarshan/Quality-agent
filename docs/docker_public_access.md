# Docker Deployment With Local Ollama + Public Link

## Architecture
- `frontend` runs in Docker on port `5173`.
- `backend` runs in Docker on port `8000`.
- `backend` calls Ollama on your host machine via `http://host.docker.internal:11434`.
- Optional `cloudflared` tunnel exposes the frontend to the internet so any device can access it.

## 1) Required backend env
In `backend/.env`, set:

```env
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Also ensure Ollama is running locally and listening on `11434`.

## 2) Build and start app containers
From repo root:

```powershell
docker compose up --build -d backend frontend
```

Check health:

```powershell
docker compose ps
docker compose logs backend --tail=50
```

Open locally:
- `http://localhost:5173`

## 3) Public URL (any device)
You have two options.

### Option A: Cloudflare Tunnel service inside compose (stable URL)
1. Create a Cloudflare Tunnel and get token from Cloudflare Zero Trust.
2. Set host env var before start:

```powershell
$env:CLOUDFLARED_TUNNEL_TOKEN="<your-token>"
```

3. Start tunnel service:

```powershell
docker compose --profile tunnel up -d cloudflared
```

4. Use your tunnel hostname (configured in Cloudflare) from any device.

### Option B: Quick temporary URL from host (no account)
If you already installed `cloudflared` on your machine:

```powershell
cloudflared tunnel --url http://localhost:5173
```

This prints a temporary `https://*.trycloudflare.com` URL.

## Low-latency notes
- Keep Ollama and Docker on the same machine (your current design) for minimal RTT.
- Keep model warm by sending periodic lightweight prompts if cold-start latency matters.
- Use wired internet or low-jitter Wi-Fi on the host for best remote UX.

## Security notes
- Anyone with the public URL can reach your app unless auth is enabled.
- Set `AUTH_BYPASS_ENABLED=false` for internet exposure.
- Restrict origins and credentials based on your production domain.
