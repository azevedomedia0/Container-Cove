# Web UI & Desktop Shortcuts

## Embedded Web UI

When a container starts, Container Cove can automatically open its web interface in an embedded iframe within the app window. This gives you a native-app feel for web-based services.

- Set the `openUrl` field on any app (e.g. `http://localhost:8080`)
- The Web UI tab appears once the container is running
- Switch between **Logs**, **Metrics**, and **Web UI** tabs in the detail view

## Open in Browser

Prefer your system browser? Click the **Open in Browser** button next to the Web UI tab.

## Desktop Shortcuts

When you install an app, Container Cove can create a `.app` bundle on your Desktop (macOS) or Start Menu entry (Windows/Linux).

- Double-click the shortcut to launch the container and open the Web UI
- Shortcuts connect via `localhost:42424` and require Container Cove to be running
- Delete shortcuts anytime from your Desktop or the app detail view

## Icon Fetching

App icons are automatically fetched from the [Dashboard Icons CDN](https://github.com/walkxcode/dashboard-icons). If an icon isn't found, a generic container icon is used.
