# Introduction

Container Cove turns Docker containers into first-class desktop apps. No terminal, no memorizing commands, no wrestling with Compose files — just launch, manage, and use your self-hosted services like any native application.

## What is Container Cove?

Built with [Electrobun](https://electrobun.dev), Container Cove is a cross-platform desktop wrapper around Docker and Podman. It gives you:

- **A visual app launcher** — Search, drag-and-drop reorder, and launch containers from a beautiful grid.
- **A curated catalog** — 26+ pre-configured self-hosted apps (Plex, Nextcloud, Home Assistant, and more) ready to install in one click.
- **Full lifecycle control** — Start, stop, restart, view live logs, health badges, and CPU/MEM metrics.
- **Desktop integration** — Auto-generated shortcuts, system tray controls, and embedded Web UIs.
- **Zero-setup container runtime** — Bundled Podman with automatic initialization on first launch.

## Who is it for?

- **Home lab enthusiasts** who want to run self-hosted services without the CLI overhead.
- **Developers** who need local databases, caches, and services spun up quickly.
- **Small teams** who want to share containerized tools with non-technical teammates.

## How it works

Container Cove bundles Podman (or uses your existing Docker/Podman installation) and manages containers through a friendly desktop interface. App definitions are stored in a local `apps.json` registry, and data volumes live under `~/.container-cove/<app-name>/`.

When you install an app from the catalog or import a Compose file, Container Cove handles port mapping, volume creation, and environment variables. You get a desktop shortcut and a live status indicator in the system tray — just like any other app.
