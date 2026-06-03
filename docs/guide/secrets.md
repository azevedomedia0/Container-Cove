# Secrets & Security

## OS Keychain Integration

Sensitive environment variables (passwords, API keys, tokens) can be stored in your operating system's native keychain instead of plain text.

- Mark any environment variable as **Secret** in the app editor
- Values are stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service
- Secrets are masked in the UI detail view (shown as `••••••`)
- They are only decrypted when launching the container

## Data Storage

App definitions and settings are stored in the OS-native config directory:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/container-cove/apps.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/container-cove/apps.json` |
| Windows | `%APPDATA%/container-cove/apps.json` |

The same folder contains:

- `settings.json` — Theme, channel, and UI preferences
- `metrics.json` — Historical container metrics
- `errors.jsonl` — Application error log

## Volume Data

App data volumes are stored under `~/.container-cove/<app-name>/`. This keeps all persistent data in one place for easy backup or migration.
