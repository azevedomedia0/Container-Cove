# Build from Source

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- macOS (primary), Windows, or Linux

**macOS:** Install [OrbStack](https://orbstack.dev) — `brew install orbstack`

**Linux:** No additional setup required (bundled Podman auto-initializes)

**Windows:** Docker Desktop or WSL2 with Podman

## Install Dependencies

```bash
bun install
```

## Development

```bash
bun start
```

This launches Container Cove in development mode with hot reload.

## Quality Checks

```bash
bun run lint         # ESLint
bun run format:check # Prettier
bun run typecheck    # TypeScript
bun run test         # Unit tests
```

## Platform Builds

```bash
bun run build:dmg             # macOS .dmg (requires code signing)
bun run build:pkg             # macOS .pkg installer
bun run build:win-installer   # Windows .exe installer
bun run build:linux-appimage  # Linux AppImage
bun run build:linux-deb       # Linux .deb package
```

See the full [BUILD.md](../BUILD.md) document for detailed build instructions, environment variables, and CI notes.
