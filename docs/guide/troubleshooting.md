# Troubleshooting

## Podman Setup Failed

The setup wizard shows recovery options if Podman initialization fails:

- **Linux:** Ensure you have permissions to run containers. Try `sudo usermod -aG podman $USER` and re-log.
- **macOS:** Make sure OrbStack is installed and running (`brew install orbstack`).
- **Windows:** Ensure Docker Desktop is running or WSL2 is properly configured.

## Docker Warning Banner

If you see a "Docker not available" banner:

- Start Docker Desktop and reopen Container Cove
- Docker is used as a fallback if Podman is unavailable
- On macOS, make sure OrbStack is running

## Launch Fails

- Check that the image name is correct and available (e.g. `nginx:latest`)
- Verify host ports aren't already in use (`lsof -i :8080` on macOS/Linux)
- Port format is always `host:container` (e.g. `8080:80`)

## Web UI Won't Load

- Ensure the container is **running** and healthy
- Check that `openUrl` matches your mapped port (e.g. if you mapped `8080:80`, use `http://localhost:8080`)
- Some apps take 30–60 seconds to start; watch the logs for readiness

## No Health or Metrics

- Container must be running for metrics to appear
- Docker CLI or Podman must be reachable from Bun
- On Linux, ensure your user has access to the Podman socket

## Reset Everything

To start fresh:

1. Quit Container Cove
2. Delete `apps.json` from the config directory (see [Secrets & Security](secrets) for paths)
3. Optionally delete `~/.container-cove/` to remove all container data
4. Relaunch Container Cove

## Desktop Icon Doesn't Launch

- Ensure Container Cove is running — shortcuts connect via `localhost:42424`
- Check that the app's container port mapping is correct
- Try launching the app from the main launcher first

## Auto-Updates Not Working

- Ensure you're on the correct release channel (Stable or Beta)
- Check your internet connection
- On macOS, the app must be in `/Applications` for auto-updates to work properly
