# Agent Proxy (Local)

This proxy keeps your `OPENAI_API_KEY` off the browser and forwards requests to the OpenAI Responses API.

## Run

```bash
cd midi-piano-roll
export OPENAI_API_KEY="..."
npm run agent:proxy
```

Defaults:
- listens on `127.0.0.1:8787`
- allows requests from `http://localhost:5173` and `http://127.0.0.1:5173`

Optional env vars:
- `AGENT_PROXY_PORT` (default `8787`)
- `AGENT_PROXY_ORIGINS` (comma-separated, overrides defaults)
- `AGENT_PROXY_ORIGIN` (legacy single-origin allowlist)
