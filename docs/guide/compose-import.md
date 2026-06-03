# Compose Import

Already have a `docker-compose.yml`? Container Cove can import it and create one app per service.

## Import Flow

1. Click **+ Add App** in the launcher
2. Select **Import Compose**
3. Choose your `docker-compose.yml` file
4. Container Cove parses the file and creates app entries for each service

## What Gets Imported

For each service, Container Cove extracts:

- **Image** and **tag**
- **Ports** — Converted to `host:container` format
- **Volumes** — Mapped to `~/.container-cove/<app-name>/`
- **Environment variables** — Pre-filled in the editor
- **Depends_on** — Logged but not enforced (you'll need to start services in order manually)

## Limitations

- Networks are not imported (Container Cove uses the default bridge network)
- Build contexts are not supported — only pre-built images
- Complex Compose features (profiles, extensions, secrets) may be skipped

## After Import

Each service appears as a separate app in your launcher grid. You can:

- Edit any app to fix port conflicts or adjust settings
- Launch services in the correct dependency order
- Group related services by renaming or reordering in the grid
