# Docker Lifecycle

Container Cove gives you full control over container state without touching a terminal.

## Start & Stop

- **Launch** (▶) — Starts the container and opens the Web UI when healthy
- **Stop** (⏹) — Gracefully stops the container
- **Restart** (↻) — One-click restart for configuration changes

## Live Logs

The detail view includes a streaming log panel that shows container output in real time. Logs are color-coded and searchable.

## Health & Metrics

When a container is running, you see:

- **Health badge** — Based on Docker health checks (if configured)
- **CPU usage** — Real-time percentage
- **Memory usage** — Current and limit
- **Auto-restart** — Unhealthy containers are automatically restarted

## Compose Import

Import existing `docker-compose.yml` files:

1. Go to **+ Add App** → **Import Compose**
2. Select your YAML file
3. Container Cove creates one app per service with auto-detected ports and volumes

## Port Mapping

Format is always `host:container` (e.g. `8080:80`). Container Cove warns you if a host port is already in use.
