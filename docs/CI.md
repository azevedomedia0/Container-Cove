# Continuous Integration

Workflow: `.github/workflows/ci.yml`

## Pipeline stages

1. **lint** — ESLint + TypeScript on Ubuntu (fast gate).
2. **unit** — `bun test` (excluding E2E) on macOS, Windows, and Linux.
3. **e2e-linux** — Docker smoke tests on Ubuntu with Docker available.
4. **e2e-macos** — Docker smoke tests on macOS via OrbStack.
5. **e2e-windows-skip** — Runs the same smoke file on Windows **without** Docker; tests self-skip when the daemon is unavailable (verifies graceful behavior on developer machines without Docker Desktop).
6. **build** — Platform artifacts (`build:mac`, `build:win`, `build:linux`).

## Windows E2E “skip check” (intentional)

The `e2e-windows-skip` job does **not** install Docker. GitHub-hosted Windows runners do not provide Docker Desktop by default, and installing it in CI is slow and flaky.

Instead, the job confirms that:

- `isDockerAvailable()` returns false when Docker is absent.
- Docker-dependent tests skip without failing the suite.
- Pure unit paths in the smoke file still execute.

Full Docker E2E coverage is provided on **Linux** and **macOS** jobs.

## Local parity

```bash
bun run lint
bun run typecheck
bun test --timeout 30000 --ignore "src/e2e/**"
bun test src/e2e/smoke.test.ts   # requires Docker
```
