# Recommended Catalog

Container Cove ships with a curated catalog of 26+ self-hosted applications. Each app is pre-configured with sensible defaults, so you can install in one click.

## Included Apps

The catalog includes popular services across categories:

- **Media** — Plex, Jellyfin, Navidrome
- **Productivity** — Nextcloud, Vaultwarden, Paperless-ngx
- **Infrastructure** — Pi-hole, AdGuard Home, Traefik
- **Development** — Gitea, Jenkins, Portainer
- **Monitoring** — Uptime Kuma, Grafana, Prometheus
- **Home Automation** — Home Assistant, Node-RED

## One-Click Install

1. Open the **Recommended** tab in the launcher
2. Find the app you want and hover over its tile
3. Click **GET**
4. Review pre-filled environment variables (editable)
5. Click **Install** — Container Cove pulls the image, creates volumes, and adds it to your grid

## Customizing Before Install

Before confirming installation, you can:

- Change ports (if the default is already in use)
- Edit environment variables (passwords, domains, etc.)
- Adjust volume mappings
- Mark sensitive values as **Secret** for keychain storage

## Adding to the Catalog

The catalog is sourced from a built-in registry. To request additions, open an issue on [GitHub](https://github.com/azevedomedia0/Container-Cove/issues).
