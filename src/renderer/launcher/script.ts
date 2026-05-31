import { Electroview } from "electrobun/view";
import type { DockerApp, DockerHubImage, IpcMessage } from "../../shared/types";
import {
  generateAppId,
  isValidPortMapping,
  normalizeName,
  parsePortMappings,
  validateLocalDomain,
  validateOpenUrl,
} from "../../shared/validation";
import { presetForImage } from "../../shared/presets";
import {
  buildCardHTML,
  buildHubCardHTML,
  collectGroups,
  filterApps,
} from "./filter";

// Electrobun ≥1.18.1 changed Electroview to require a config arg; pass {} to
// avoid the "Cannot read properties of undefined (reading 'rpc')" crash.
// Polyfill ev.on / ev.send to match the Electrobun RPC envelope format:
//   { type: "message", id: <channel>, payload: <data> }
const ev = new Electroview({} as any);
(ev as any).on = function (
  name: string,
  handler: (msg: unknown) => void,
): void {
  // rpcHandler receives the full RPC envelope from bun; unwrap payload before
  // dispatching so the handler sees the raw IpcMessage, not the envelope.
  this.rpcHandler = (envelope: any) => {
    if (envelope?.type === "message" && envelope?.id === name) {
      handler(envelope.payload);
    }
  };
};
(ev as any).send = function (name: string, payload: unknown): void {
  // Wrap in the RPC message envelope that Electrobun's bun-side handler expects.
  this.bunBridge(JSON.stringify({ type: "message", id: name, payload }));
};

// ── OG image cache ──────────────────────────────────────────────
// docker image reference → og:image URL received from the main process
const ogImageCache = new Map<string, string>();

function overlayOgImage(icon: HTMLElement, url: string) {
  if (icon.querySelector(".app-card__og-img")) return; // already applied
  const img = document.createElement("img");
  img.className = "app-card__og-img";
  img.src = url;
  img.alt = "";
  img.addEventListener("error", () => img.remove());
  icon.appendChild(img);
}

function applyOgImagesFromCache() {
  document
    .querySelectorAll<HTMLElement>(".app-card__icon[data-app-image]")
    .forEach((icon) => {
      const ref = icon.dataset.appImage!;
      const url = ogImageCache.get(ref);
      if (url) overlayOgImage(icon, url);
    });
}

let apps: DockerApp[] = [];
let editTarget: DockerApp | null = null;
let firstRun = false;
let hubImages: DockerHubImage[] = [];
let searchTerm = "";
let statusFilter = "all";
let groupFilter = "all";
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

// Apps waiting to have their web UI auto-opened once they finish starting
const pendingWebUiOpen = new Set<string>();

// Current app data directory (set from settings, used for volume path substitution)
let dataDir = "~/.container-cove";
// System identity values — received from main once on startup
let systemUid = "1000";
let systemGid = "1000";
let systemTz = "UTC";

// ── Search mode: "apps" filters the installed grid; "hub" searches DockerHub inline
type SearchMode = "apps" | "hub";
let searchMode: SearchMode = "apps";
// Flag so the dockerhub:results handler knows to route to inline vs. the hub modal
let hubResultsTarget: "modal" | "inline" = "modal";

let pendingUpdateInfo: {
  version: string;
  releaseNotes: string;
  downloadUrl: string;
  channel: "stable" | "beta";
} | null = null;
let onboardingVisible = false;
let podmanAvailable: boolean | null = null;
let availableNetworks: string[] = [];
let pendingNetworkSelectTarget: "add" | "edit" | null = null;
let pendingNetworkName: string | null = null;
let pendingTrayBulkAction: "stop-all" | "restart-all" | null = null;
let pendingRestartTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingRestartId: string | null = null;

// Hub search cache: query (or "" for popular) → results
const hubCache = new Map<string, DockerHubImage[]>();

// Tracks GET buttons currently installing: appId → button element
const installingRecApps = new Map<string, HTMLButtonElement>();

function setRecBtnInstalled(button: HTMLButtonElement) {
  button.classList.add("btn-pill--added");
  button.textContent = "✓ Added";
  button.disabled = true;
  button.replaceWith(button.cloneNode(true) as HTMLButtonElement);
}

function startRecInstall(app: RecommendedApp, button: HTMLButtonElement) {
  const appId = generateAppId(app.name);
  button.disabled = true;
  button.classList.add("btn-pill--installing");
  const spinner = document.createElement("span");
  spinner.className = "rec-spin";
  button.textContent = "";
  button.appendChild(spinner);
  button.appendChild(document.createTextNode("Installing…"));
  installingRecApps.set(appId, button);
  send({
    type: "app:add",
    app: {
      id: appId,
      name: app.name,
      image: app.image,
      icon: app.icon,
      description: app.description,
      iconSlug: app.iconSlug,
      iconUrl: app.iconUrl,
      ports: app.ports ?? [],
      volumes: (app.volumes ?? []).map((v) =>
        v.replace("~/.container-cove", dataDir),
      ),
      env: Object.fromEntries(
        Object.entries(app.env ?? {}).map(([k, v]) => {
          let val = v.replace("~/.container-cove", dataDir);
          if (k === "PUID") val = systemUid;
          else if (k === "PGID") val = systemGid;
          else if (k === "UID") val = systemUid;
          else if (k === "GID") val = systemGid;
          else if (k === "TZ" && (v === "UTC" || v === "")) val = systemTz;
          return [k, val];
        }),
      ),
      openUrl: app.openUrl,
      group: app.category,
      restartPolicy: app.restartPolicy ?? "no",
    },
  });
}

// ── Recommended Apps catalogue ──────────────────────────────────

interface RecommendedApp {
  category: string;
  name: string;
  image: string;
  icon: string;
  /** Dashboard Icons slug — https://github.com/walkxcode/dashboard-icons */
  iconSlug?: string;
  /** Custom icon image URL (overrides iconSlug when set) */
  iconUrl?: string;
  /** When true the icon image fills the entire square (no padding) */
  iconFill?: boolean;
  description: string;
  ports?: string[];
  openUrl?: string;
  restartPolicy?: "no" | "on-failure" | "unless-stopped";
  env?: Record<string, string>;
  volumes?: string[];
}

const ICON_CDN =
  "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@main/png";

const RECOMMENDED_APPS: RecommendedApp[] = [
  // Self-hosted Essentials
  // Admin credentials pre-set so the UI is accessible immediately on first launch.
  { category: "Self-hosted Essentials", name: "Nextcloud", image: "nextcloud:latest", icon: "☁️", iconSlug: "nextcloud", iconUrl: "https://images.icon-icons.com/2108/PNG/512/nextcloud_icon_130873.png", description: "File hosting, calendar, contacts, and full collaboration suite. Default login: admin / changeme.", ports: ["8080:80"], openUrl: "http://localhost:8080", restartPolicy: "unless-stopped",
    env: { NEXTCLOUD_ADMIN_USER: "admin", NEXTCLOUD_ADMIN_PASSWORD: "changeme" },
    volumes: ["~/.container-cove/nextcloud:/var/www/html"] },

  // WordPress: requires a MySQL/MariaDB database — add your DB connection details before launching.
  { category: "Self-hosted Essentials", name: "WordPress", image: "wordpress:latest", icon: "📝", iconSlug: "wordpress", description: "The world's most popular CMS. Requires a MySQL or MariaDB database — set the DB env vars to connect.", ports: ["8082:80"], openUrl: "http://localhost:8082", restartPolicy: "unless-stopped",
    env: { WORDPRESS_DB_HOST: "", WORDPRESS_DB_USER: "wordpress", WORDPRESS_DB_PASSWORD: "", WORDPRESS_DB_NAME: "wordpress" },
    volumes: ["~/.container-cove/wordpress:/var/www/html"] },

{ category: "Self-hosted Essentials", name: "Puter", image: "ghcr.io/heyputer/puter:latest", icon: "🖥️", iconSlug: "puter", description: "Self-hosted cloud desktop — files, apps, and AI in your browser.", ports: ["4100:4100"], openUrl: "http://localhost:4100", restartPolicy: "unless-stopped",
    volumes: ["~/.container-cove/puter/config:/root/.config/puter"] },

  // Tailscale: userspace mode avoids the /dev/net/tun bind-mount and NET_ADMIN cap requirement
  // so it starts cleanly inside Docker Desktop on macOS. Paste your auth key to connect.
  { category: "Self-hosted Essentials", name: "Tailscale", image: "tailscale/tailscale:latest", icon: "🔐", iconSlug: "tailscale", iconUrl: "https://tailscale.com/favicon.png", description: "Mesh VPN for secure private networking. Paste your auth key into TS_AUTHKEY, then restart to connect.", ports: [], restartPolicy: "unless-stopped",
    env: { TS_AUTHKEY: "", TS_USERSPACE: "1", TS_STATE_DIR: "/var/lib/tailscale" },
    volumes: ["~/.container-cove/tailscale/state:/var/lib/tailscale"] },

  // Photo Libraries
  { category: "Photo Libraries", name: "Immich", image: "ghcr.io/immich-app/immich-server:release", icon: "📸", iconSlug: "immich", description: "Self-hosted photo and video backup with AI-powered search and face recognition. Requires a PostgreSQL database and Redis — start those first or use Compose.", ports: ["2283:3001"], openUrl: "http://localhost:2283", restartPolicy: "unless-stopped",
    env: { DB_HOSTNAME: "host.docker.internal", DB_USERNAME: "postgres", DB_PASSWORD: "postgres", DB_DATABASE_NAME: "immich", REDIS_HOSTNAME: "host.docker.internal" },
    volumes: ["~/.container-cove/immich/upload:/usr/src/app/upload", "~/Pictures:/usr/src/app/upload/library"] },

  { category: "Photo Libraries", name: "PhotoPrism", image: "photoprism/photoprism:latest", icon: "🖼️", iconSlug: "photoprism", description: "AI-powered photo management with face recognition and geo-tagging. Default login: admin / changeme.", ports: ["2342:2342"], openUrl: "http://localhost:2342", restartPolicy: "unless-stopped",
    env: { PHOTOPRISM_AUTH_MODE: "password", PHOTOPRISM_ADMIN_USER: "admin", PHOTOPRISM_ADMIN_PASSWORD: "changeme", PHOTOPRISM_HTTP_COMPRESSION: "gzip", PHOTOPRISM_DATABASE_DRIVER: "sqlite" },
    volumes: ["~/.container-cove/photoprism/storage:/photoprism/storage", "~/Pictures:/photoprism/originals"] },

  // Media Servers
  { category: "Media Servers", name: "Plex", image: "lscr.io/linuxserver/plex:latest", icon: "🎬", iconSlug: "plex", description: "Powerful media server for movies, TV, music, and photos.", ports: ["32400:32400"], openUrl: "http://localhost:32400/web", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC", VERSION: "docker", PLEX_CLAIM: "" },
    volumes: ["~/.container-cove/plex/config:/config", "~/Movies:/movies", "~/Music:/music", "~/TV:/tv"] },

  { category: "Media Servers", name: "Jellyfin", image: "jellyfin/jellyfin:latest", icon: "🎞️", iconSlug: "jellyfin", description: "Free open-source media system — no subscriptions, no tracking.", ports: ["8096:8096"], openUrl: "http://localhost:8096", restartPolicy: "unless-stopped",
    env: { TZ: "UTC" },
    volumes: ["~/.container-cove/jellyfin/config:/config", "~/.container-cove/jellyfin/cache:/cache", "~/Movies:/movies", "~/Music:/music", "~/TV:/tv"] },

  // Emby uses host port 8097 to avoid collision with Jellyfin on 8096.
  { category: "Media Servers", name: "Emby", image: "emby/embyserver:latest", icon: "📺", iconSlug: "emby", description: "Personal media server — organise and stream your movies, TV, and music to any device.", ports: ["8097:8096", "8920:8920"], openUrl: "http://localhost:8097/web", restartPolicy: "unless-stopped",
    env: { UID: "1000", GID: "1000" },
    volumes: ["~/.container-cove/emby/config:/config", "~/Movies:/mnt/movies", "~/Music:/mnt/music", "~/TV:/mnt/tv"] },

  { category: "Media Servers", name: "Navidrome", image: "deluan/navidrome:latest", icon: "🎵", iconSlug: "navidrome", description: "Modern self-hosted music server and streamer, compatible with Subsonic clients.", ports: ["4533:4533"], openUrl: "http://localhost:4533", restartPolicy: "unless-stopped",
    env: { ND_MUSICFOLDER: "/music", ND_DATAFOLDER: "/data", ND_LOGLEVEL: "info" },
    volumes: ["~/.container-cove/navidrome/data:/data", "~/Music:/music:ro"] },

  // AI & Automation
  { category: "AI & Automation", name: "Ollama", image: "ollama/ollama:latest", icon: "🤖", iconSlug: "ollama", description: "Run large language models locally with a simple REST API.", ports: ["11434:11434"], restartPolicy: "unless-stopped",
    volumes: ["~/.container-cove/ollama:/root/.ollama"] },

  { category: "AI & Automation", name: "n8n", image: "n8nio/n8n:latest", icon: "⚙️", iconSlug: "n8n", description: "Workflow automation with 400+ integrations and a visual node editor.", ports: ["5678:5678"], openUrl: "http://localhost:5678", restartPolicy: "unless-stopped",
    env: { N8N_BASIC_AUTH_ACTIVE: "false", N8N_PORT: "5678" },
    volumes: ["~/.container-cove/n8n:/home/node/.n8n"] },

  // Open WebUI: chat UI for local LLMs — connects to Ollama automatically.
  // host.docker.internal resolves to the host on both Podman (macOS machine / Linux ≥4) and Docker.
  { category: "AI & Automation", name: "Open WebUI", image: "ghcr.io/open-webui/open-webui:main", icon: "💬", iconSlug: "open-webui", description: "Feature-rich chat UI for Ollama and OpenAI-compatible APIs. Auto-connects to a local Ollama instance.", ports: ["3000:8080"], openUrl: "http://localhost:3000", restartPolicy: "unless-stopped",
    env: { OLLAMA_BASE_URL: "http://host.docker.internal:11434", WEBUI_AUTH: "false" },
    volumes: ["~/.container-cove/open-webui:/app/backend/data"] },

  { category: "AI & Automation", name: "Hermes Chat", image: "ghcr.io/hermeschat/hermes:latest", icon: "💬", iconSlug: "hermes-icon", description: "Self-hosted team chat and messaging platform.", ports: ["3000:3000"], openUrl: "http://localhost:3000", restartPolicy: "unless-stopped",
    volumes: ["~/.container-cove/hermes/data:/app/data"] },

  // Media Management
  { category: "Media Management", name: "Radarr", image: "lscr.io/linuxserver/radarr:latest", icon: "🎥", iconSlug: "radarr", description: "Movie collection manager with automated downloading and organisation.", ports: ["7878:7878"], openUrl: "http://localhost:7878", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC" },
    volumes: ["~/.container-cove/radarr/config:/config", "~/Movies:/movies", "~/Downloads:/downloads"] },

  { category: "Media Management", name: "Sonarr", image: "lscr.io/linuxserver/sonarr:latest", icon: "📺", iconSlug: "sonarr", description: "TV series manager with automatic episode monitoring and downloading.", ports: ["8989:8989"], openUrl: "http://localhost:8989", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC" },
    volumes: ["~/.container-cove/sonarr/config:/config", "~/TV:/tv", "~/Downloads:/downloads"] },

  { category: "Media Management", name: "Bazarr", image: "lscr.io/linuxserver/bazarr:latest", icon: "🗣️", iconSlug: "bazarr", description: "Subtitle manager that integrates with Radarr and Sonarr.", ports: ["6767:6767"], openUrl: "http://localhost:6767", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC" },
    volumes: ["~/.container-cove/bazarr/config:/config", "~/Movies:/movies", "~/TV:/tv"] },

  { category: "Media Management", name: "Lidarr", image: "lscr.io/linuxserver/lidarr:latest", icon: "🎵", iconSlug: "lidarr", description: "Music collection manager with automated album downloading.", ports: ["8686:8686"], openUrl: "http://localhost:8686", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC" },
    volumes: ["~/.container-cove/lidarr/config:/config", "~/Music:/music", "~/Downloads:/downloads"] },

  // qBittorrent: WEBUI_PORT must match the container-side of the port mapping (8080), not the host port.
  { category: "Media Management", name: "qBittorrent", image: "lscr.io/linuxserver/qbittorrent:latest", icon: "⬇️", iconSlug: "qbittorrent", description: "Feature-rich torrent client with a web-based management UI. Default login: admin / adminadmin.", ports: ["8090:8080", "6881:6881"], openUrl: "http://localhost:8090", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC", WEBUI_PORT: "8080" },
    volumes: ["~/.container-cove/qbittorrent/config:/config", "~/Downloads:/downloads"] },

  // Calibre-Web: DOCKER_MODS removed — the Calibre mod triggers a multi-minute install on first boot.
  { category: "Media Management", name: "Calibre-Web", image: "lscr.io/linuxserver/calibre-web:latest", icon: "📚", iconSlug: "calibre-web", description: "Web-based eBook manager and reader. Point it at an existing Calibre library folder on first launch.", ports: ["8083:8083"], openUrl: "http://localhost:8083", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000", TZ: "UTC" },
    volumes: ["~/.container-cove/calibre-web/config:/config", "~/Books:/books"] },

  // Smart Home & Network
  { category: "Smart Home & Network", name: "Home Assistant", image: "ghcr.io/home-assistant/home-assistant:latest", icon: "🏠", iconSlug: "home-assistant", description: "Open source home automation platform for smart home control.", ports: ["8123:8123"], openUrl: "http://localhost:8123", restartPolicy: "unless-stopped",
    env: { TZ: "UTC" },
    volumes: ["~/.container-cove/home-assistant/config:/config"] },

  // Pi-hole: port 53 is reserved by macOS mDNSResponder, so DNS is exposed on host port 5353.
  { category: "Smart Home & Network", name: "Pi-hole", image: "pihole/pihole:latest", icon: "🛡️", iconSlug: "pi-hole", description: "Network-wide ad and tracker blocking via DNS sinkhole. Admin password: changeme. DNS available on port 5353.", ports: ["8053:80", "5353:53/tcp", "5353:53/udp"], openUrl: "http://localhost:8053/admin", restartPolicy: "unless-stopped",
    env: { TZ: "UTC", WEBPASSWORD: "changeme" },
    volumes: ["~/.container-cove/pihole/etc-pihole:/etc/pihole", "~/.container-cove/pihole/etc-dnsmasq.d:/etc/dnsmasq.d"] },

  { category: "Smart Home & Network", name: "Nginx Proxy Manager", image: "jc21/nginx-proxy-manager:latest", icon: "🔀", iconSlug: "nginx-proxy-manager", description: "Reverse proxy with a web UI for hosts, SSL (Let's Encrypt), and access lists. Default login: admin@example.com / changeme.", ports: ["8181:81", "8880:80", "4443:443"], openUrl: "http://localhost:8181", restartPolicy: "unless-stopped",
    volumes: ["~/.container-cove/nginx-proxy-manager/data:/data", "~/.container-cove/nginx-proxy-manager/letsencrypt:/etc/letsencrypt"] },

  // Cloudflare DDNS: correct env var is CF_API_TOKEN (not CLOUDFLARE_API_TOKEN).
  { category: "Smart Home & Network", name: "Cloudflare DDNS", image: "favonia/cloudflare-ddns:latest", icon: "☁️", iconSlug: "cloudflare", description: "Keeps your Cloudflare DNS records in sync when your public IP changes. Add your API token and domain to activate.", ports: [], restartPolicy: "unless-stopped",
    env: { CF_API_TOKEN: "", DOMAINS: "example.com", PROXIED: "false", UPDATE_CRON: "@every 5m" } },

  { category: "Smart Home & Network", name: "Homebridge", image: "homebridge/homebridge:latest", icon: "🏡", iconSlug: "homebridge", description: "Bridge non-HomeKit smart home devices to Apple HomeKit via a lightweight Node.js server.", ports: ["8581:8581"], openUrl: "http://localhost:8581", restartPolicy: "unless-stopped",
    env: { TZ: "UTC", HOMEBRIDGE_CONFIG_UI: "1", HOMEBRIDGE_CONFIG_UI_PORT: "8581" },
    volumes: ["~/.container-cove/homebridge/config:/homebridge"] },

  { category: "Smart Home & Network", name: "Syncthing", image: "syncthing/syncthing:latest", icon: "🔄", iconSlug: "syncthing", description: "Continuous file synchronisation — securely sync files between devices without a central server.", ports: ["8384:8384", "22000:22000"], openUrl: "http://localhost:8384", restartPolicy: "unless-stopped",
    env: { PUID: "1000", PGID: "1000" },
    volumes: ["~/.container-cove/syncthing/config:/var/syncthing/config", "~/Sync:/var/syncthing/data"] },
];

function send(msg: IpcMessage) {
  ev.send("ipc-message", msg);
}

// ── Banners ────────────────────────────────────────────────────

function showBanner(id: string, message: string, timeout = 4500) {
  const banner = document.getElementById(id);
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove("hidden");
  if (timeout > 0)
    window.setTimeout(() => banner.classList.add("hidden"), timeout);
}

function showRestartToast(appName: string, appId: string) {
  // Cancel any existing pending restart
  if (pendingRestartTimeout) {
    clearTimeout(pendingRestartTimeout);
    pendingRestartTimeout = null;
    pendingRestartId = null;
  }

  const toast = document.getElementById("restart-toast");
  const msg = document.getElementById("restart-toast-msg");
  if (!toast || !msg) return;

  pendingRestartId = appId;
  msg.textContent = `Restarting ${appName}…`;
  toast.classList.remove("hidden");

  pendingRestartTimeout = window.setTimeout(() => {
    pendingRestartTimeout = null;
    pendingRestartId = null;
    toast.classList.add("hidden");
    send({ type: "app:restart", id: appId });
  }, 3000);
}
function showError(message: string) {
  showBanner("error-banner", message);
}
function hideTrayBulkActionModal() {
  pendingTrayBulkAction = null;
  document.getElementById("tray-confirm-modal")?.classList.add("hidden");
}
function showTrayBulkActionModal(action: "stop-all" | "restart-all") {
  pendingTrayBulkAction = action;
  const modal = document.getElementById("tray-confirm-modal");
  const title = document.getElementById("tray-confirm-title");
  const body = document.getElementById("tray-confirm-body");
  const accept = document.getElementById("tray-confirm-accept") as HTMLButtonElement | null;
  if (!modal || !title || !body || !accept) return;
  title.textContent = action === "stop-all" ? "Stop all running containers?" : "Restart all running containers?";
  body.textContent = action === "stop-all"
    ? "This will stop every running app in the tray. Any open web UIs will close and services will go offline until you launch them again."
    : "This will restart every running app in the tray. Services may briefly disappear while containers come back up.";
  accept.textContent = action === "stop-all" ? "Stop All" : "Restart All";
  accept.classList.toggle("btn--danger", action === "stop-all");
  accept.classList.toggle("btn--primary", action !== "stop-all");
  modal.classList.remove("hidden");
}
let podmanStartAttempted = false;
function showOnboardingPanel() {
  const panel = document.getElementById("onboarding-panel");
  if (!panel) return;
  if (onboardingVisible) return;
  onboardingVisible = true;
  panel.classList.remove("hidden");
}

function hideOnboardingPanel() {
  const panel = document.getElementById("onboarding-panel");
  if (!panel) return;
  onboardingVisible = false;
  panel.classList.add("hidden");
}

function setRecommendedSectionOpen(open: boolean) {
  const section = document.getElementById("section-recommended") as HTMLDetailsElement | null;
  if (!section) return;
  section.open = open;
}

function setPodmanInstallPromptVisible(visible: boolean) {
  const bannerCta = document.getElementById("btn-docker-install");
  const onboardingCta = document.getElementById("onboarding-podman-install");
  if (bannerCta) bannerCta.classList.toggle("hidden", !visible);
  if (onboardingCta) onboardingCta.classList.toggle("hidden", !visible);
}

function updateOnboardingPodmanCopy(isFirstRun: boolean) {
  const strong = document.querySelector("#onboarding-podman-install .onboarding-install__copy strong");
  const small = document.querySelector("#onboarding-podman-install .onboarding-install__copy small");
  if (!strong || !small) return;
  if (isFirstRun) {
    strong.textContent = "Install Podman first";
    small.textContent = "Container Cove uses Podman to run your apps. Open the install guide, install Podman, then come back and click Retry.";
  } else {
    strong.textContent = "Podman is not responding";
    small.textContent = "Podman was working before but is no longer available. Click Retry to restart it, or open the install guide if it has been uninstalled.";
  }
}

function updateDataDirDisplays(path: string) {
  const el = document.getElementById("settings-datadir-path");
  if (el) el.textContent = path;
}

function populateNetworkSelect(selectId: string, currentValue = "") {
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return;
  const selected = currentValue || select.value || "";
  while (select.firstChild) select.removeChild(select.firstChild);
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Default";
  select.appendChild(defaultOpt);
  for (const name of availableNetworks) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = availableNetworks.includes(selected) ? selected : "";
}

function refreshNetworkSelects(addValue = "", editValue = "") {
  populateNetworkSelect("add-network", addValue);
  populateNetworkSelect("edit-network", editValue);
}

function requestNetworksList() {
  send({ type: "networks:list" });
}

function promptForNetworkName(): string | null {
  const value = window.prompt("Create a new Docker network", "");
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function toggleDockerWarning(show: boolean) {
  setDockerWarningState(
    show
      ? {
          visible: true,
          message: podmanStartAttempted
            ? "Podman is still coming up. Please wait…"
            : "Starting Podman — please wait…",
          canRetry: false,
          canInstall: false,
        }
      : { visible: false },
  );
}

function setDockerWarningState(state: {
  visible: boolean;
  message?: string;
  detail?: string;
  canRetry?: boolean;
  canInstall?: boolean;
}) {
  const banner = document.getElementById("docker-warning");
  const label = document.getElementById("docker-warning-text");
  const detailEl = document.getElementById("docker-warning-detail");
  const install = document.getElementById("btn-docker-install") as HTMLButtonElement | null;
  const retry = document.getElementById("btn-docker-retry") as HTMLButtonElement | null;
  if (!banner || !label || !retry) return;
  banner.classList.toggle("hidden", !state.visible);
  if (install) {
    install.classList.toggle("hidden", !state.visible || !state.canInstall);
    install.textContent = "Open install guide";
  }
  if (detailEl) {
    detailEl.classList.toggle("hidden", !state.visible || !state.detail);
    detailEl.textContent = state.detail ?? "";
  }
  if (!state.visible) {
    podmanStartAttempted = false;
    retry.classList.add("hidden");
    if (install) install.classList.add("hidden");
    return;
  }
  podmanStartAttempted = true;
  label.textContent = state.message ?? "Podman is unavailable.";
  retry.classList.toggle("hidden", !state.canRetry);
}

// ── Update chip (topbar one-click flow) ─────────────────────────

type UpdateChipState = "idle" | "checking" | "available" | "downloading" | "ready";

function setUpdateChip(state: UpdateChipState, label = "", percent = 0) {
  const chip = document.getElementById("update-chip")!;
  const lbl = document.getElementById("update-chip-label")!;
  const bar = document.getElementById("update-chip-bar")!;
  const fill = document.getElementById("update-chip-fill") as HTMLElement;

  chip.className = "update-chip";
  bar.classList.add("hidden");

  if (state === "idle") { chip.classList.add("hidden"); return; }
  chip.classList.remove("hidden");

  if (state === "checking") {
    lbl.textContent = "Checking…";
  } else if (state === "available") {
    chip.classList.add("update-chip--available");
    lbl.textContent = label || "Update available — click to install";
  } else if (state === "downloading") {
    chip.classList.add("update-chip--downloading");
    lbl.textContent = `Downloading… ${percent}%`;
    bar.classList.remove("hidden");
    fill.style.width = `${percent}%`;
  } else if (state === "ready") {
    chip.classList.add("update-chip--ready");
    lbl.textContent = "✓ Restart to apply update";
  }
}

// Click on the chip while in "available" state starts the download
document.getElementById("update-chip")!.addEventListener("click", () => {
  if (!pendingUpdateInfo?.downloadUrl) return;
  if (!document.getElementById("update-chip")!.classList.contains("update-chip--available")) return;
  send({
    type: "update:download",
    downloadUrl: pendingUpdateInfo.downloadUrl,
    version: pendingUpdateInfo.version,
    channel: pendingUpdateInfo.channel,
  });
  setUpdateChip("downloading", "", 0);
});

// ── Theme ────────────────────────────────────────────────────────

function applyTheme(t: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", t);
  const sun = document.getElementById("icon-sun")!;
  const moon = document.getElementById("icon-moon")!;
  sun.classList.toggle("hidden", t === "dark");
  moon.classList.toggle("hidden", t === "light");
}

document.getElementById("btn-theme-toggle")!.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") as "dark" | "light";
  const next: "dark" | "light" = current === "dark" ? "light" : "dark";
  applyTheme(next);
  send({ type: "settings:theme", theme: next });
});

// ── Grid rendering ──────────────────────────────────────────────

function filteredApps(): DockerApp[] {
  return filterApps(apps, searchTerm, statusFilter, groupFilter);
}

function refreshGroupFilterOptions() {
  // group-filter dropdown removed from UI — no-op
}

function wireCardButtons(card: HTMLElement, app: DockerApp) {
  // Icon click: open web UI (running) or launch (stopped)
  const iconEl = card.querySelector<HTMLElement>(".app-card__icon--clickable");
  if (iconEl) {
    iconEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (iconEl.dataset.busy) return;
      if (iconEl.dataset.action === "open") {
        // App is running — open dedicated web UI window or app detail window
        if (app.openUrl) {
          send({ type: "app:open-webui", id: app.id });
        } else {
          send({ type: "app:open-window", app });
        }
      } else {
        // App is stopped — launch it; auto-open web UI once it's up
        if (app.openUrl) pendingWebUiOpen.add(app.id);
        send({ type: "app:launch", id: app.id });
      }
    });
  }
  card.querySelector("[data-action='stop']")?.addEventListener("click", (e) => {
    e.stopPropagation();
    send({ type: "app:stop", id: app.id });
  });
  card.querySelector("[data-action='restart']")?.addEventListener("click", (e) => {
    e.stopPropagation();
    showRestartToast(app.name, app.id);
  });
  card.querySelector("[data-action='edit']")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditModal(app);
  });
}

// ── Drag-and-drop reorder ───────────────────────────────────────

let dragSrcId: string | null = null;

function wireDragDrop(card: HTMLElement, app: DockerApp) {
  card.setAttribute("draggable", "true");
  card.addEventListener("dragstart", (e) => {
    dragSrcId = app.id;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", app.id);
  });
  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    card.classList.add("app-card--drag-over");
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("app-card--drag-over");
  });
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("app-card--drag-over");
    if (!dragSrcId || dragSrcId === app.id) return;
    // Reorder in local array then persist
    const srcIdx = apps.findIndex((a) => a.id === dragSrcId);
    const dstIdx = apps.findIndex((a) => a.id === app.id);
    if (srcIdx < 0 || dstIdx < 0) return;
    const reordered = [...apps];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(dstIdx, 0, moved);
    apps = reordered;
    send({ type: "app:reorder", ids: apps.map((a) => a.id) });
    renderGrid();
    dragSrcId = null;
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("app-card--drag-over");
  });
}

function makeCard(app: DockerApp): HTMLElement {
  const card = document.createElement("div");
  card.className = "app-card";
  card.dataset.id = app.id;
  card.innerHTML = buildCardHTML(app);
  // Apply cached og image immediately if available
  const cachedOg = ogImageCache.get(app.image);
  if (cachedOg) {
    const icon = card.querySelector<HTMLElement>(".app-card__icon");
    if (icon) overlayOgImage(icon, cachedOg);
  }
  card.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".app-card__cta")) return;
    if (t.closest(".app-card__icon--clickable")) return;
    send({ type: "app:open-window", app });
  });
  wireCardButtons(card, app);
  wireDragDrop(card, app);
  return card;
}

let vsFiltered: DockerApp[] = [];

function renderGrid() {
  const grid = document.getElementById("grid")!;
  vsFiltered = filteredApps();

  if (vsFiltered.length <= 80) {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    for (const app of vsFiltered) grid.appendChild(makeCard(app));
  } else {
    renderVirtualGrid(grid);
  }

}

function renderVirtualGrid(grid: HTMLElement) {
  const BATCH = 40;
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  let rendered = 0;

  function renderBatch(from: number) {
    const end = Math.min(from + BATCH, vsFiltered.length);
    for (let i = from; i < end; i++) grid.appendChild(makeCard(vsFiltered[i]));
    rendered = end;
    if (rendered < vsFiltered.length) {
      const sentinel = document.createElement("div");
      sentinel.className = "virtual-sentinel";
      grid.appendChild(sentinel);
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            obs.disconnect();
            sentinel.remove();
            renderBatch(rendered);
          }
        },
        { rootMargin: "200px" },
      );
      obs.observe(sentinel);
    }
  }
  renderBatch(0);
}

function updateCard(app: DockerApp) {
  const card = document.querySelector(
    `.app-card[data-id="${app.id}"]`,
  ) as HTMLElement | null;
  if (!card) { renderGrid(); return; }
  card.innerHTML = buildCardHTML(app);
  // Re-apply cached og image (innerHTML wipe removes the overlay)
  const cachedOg = ogImageCache.get(app.image);
  if (cachedOg) {
    const icon = card.querySelector<HTMLElement>(".app-card__icon");
    if (icon) overlayOgImage(icon, cachedOg);
  }
  wireCardButtons(card, app);
  wireDragDrop(card, app);
}

// ── Env-var table editor ────────────────────────────────────────

interface _EnvRow { key: string; value: string; keychain: boolean }

function buildEnvTable(
  containerId: string,
  initial: Record<string, string> = {},
  keychainKeys: string[] = [],
): void {
  const container = document.getElementById(containerId)!;
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const [k, v] of Object.entries(initial)) {
    addEnvRow(container, k, v, keychainKeys.includes(k));
  }
}

function addEnvRow(
  container: HTMLElement,
  k = "",
  v = "",
  inKeychain = false,
): void {
  const row = document.createElement("div");
  row.className = "kv-row";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.placeholder = "KEY";
  keyInput.value = k;
  keyInput.className = "kv-key";

  const valInput = document.createElement("input");
  valInput.type = "text";
  valInput.placeholder = "value";
  valInput.value = v;
  valInput.className = "kv-val";

  const removeBtn = document.createElement("button");
  removeBtn.className = "kv-remove";
  removeBtn.textContent = "✕";
  removeBtn.type = "button";
  removeBtn.addEventListener("click", () => container.removeChild(row));

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function readEnvTable(containerId: string): { env: Record<string, string>; keychainKeys: string[] } {
  const container = document.getElementById(containerId)!;
  const env: Record<string, string> = {};
  const keychainKeys: string[] = [];
  for (const row of container.querySelectorAll(".kv-row")) {
    const k = (row.querySelector(".kv-key") as HTMLInputElement).value.trim();
    const v = (row.querySelector(".kv-val") as HTMLInputElement).value;
    if (k) {
      env[k] = v;
    }
  }
  return { env, keychainKeys };
}

// ── Volume table editor ─────────────────────────────────────────

function buildVolTable(containerId: string, initial: string[] = []): void {
  const container = document.getElementById(containerId)!;
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const v of initial) addVolRow(container, v);
}

function addVolRow(container: HTMLElement, value = ""): void {
  const row = document.createElement("div");
  row.className = "vol-row";

  const [host = "", rest = ""] = value.split(":");
  const containerPath = rest.split(":").slice(0, 1).join("") || "";

  const hostInput = document.createElement("input");
  hostInput.type = "text";
  hostInput.placeholder = "~/host/path";
  hostInput.value = host;
  hostInput.className = "vol-host";

  const sep = document.createElement("span");
  sep.textContent = ":";
  sep.style.color = "var(--muted)";

  const containerInput = document.createElement("input");
  containerInput.type = "text";
  containerInput.placeholder = "/container/path";
  containerInput.value = containerPath;
  containerInput.className = "vol-container";

  const removeBtn = document.createElement("button");
  removeBtn.className = "vol-remove";
  removeBtn.textContent = "✕";
  removeBtn.type = "button";
  removeBtn.addEventListener("click", () => container.removeChild(row));

  row.appendChild(hostInput);
  row.appendChild(sep);
  row.appendChild(containerInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function readVolTable(containerId: string): string[] {
  const container = document.getElementById(containerId)!;
  const vols: string[] = [];
  for (const row of container.querySelectorAll(".vol-row")) {
    const h = (row.querySelector(".vol-host") as HTMLInputElement).value.trim();
    const c = (row.querySelector(".vol-container") as HTMLInputElement).value.trim();
    if (h && c) vols.push(`${h}:${c}`);
  }
  return vols;
}

// ── Modal wiring ────────────────────────────────────────────────

function openEditModal(app: DockerApp) {
  editTarget = app;
  (document.getElementById("edit-name") as HTMLInputElement).value = app.name;
  (document.getElementById("edit-image") as HTMLInputElement).value = app.image;
  (document.getElementById("edit-ports") as HTMLInputElement).value = app.ports.join(", ");
  (document.getElementById("edit-url") as HTMLInputElement).value = app.openUrl ?? "";
  (document.getElementById("edit-group") as HTMLInputElement).value = app.group ?? "";
  (document.getElementById("edit-restart") as HTMLSelectElement).value = app.restartPolicy ?? "no";
  populateNetworkSelect("edit-network", app.network ?? "");
  (document.getElementById("edit-local-domain") as HTMLInputElement).value = app.localDomain ?? "";
  buildEnvTable("edit-env-table", app.env, app.keychainEnvKeys);
  buildVolTable("edit-vol-table", app.volumes);
  // Show the Stop button only when the app is currently running
  const stopBtn = document.getElementById("btn-edit-stop") as HTMLButtonElement;
  stopBtn.classList.toggle("hidden", app.status !== "running");
  document.getElementById("modal-edit")!.classList.remove("hidden");
  requestNetworksList();
}

function parseHealth(prefix: "add" | "edit") {
  const cmd = (document.getElementById(`${prefix}-health-cmd`) as HTMLInputElement).value.trim();
  const intervalSec = Number((document.getElementById(`${prefix}-health-interval`) as HTMLInputElement).value || "0") || undefined;
  const timeoutSec = Number((document.getElementById(`${prefix}-health-timeout`) as HTMLInputElement).value || "0") || undefined;
  const retries = Number((document.getElementById(`${prefix}-health-retries`) as HTMLInputElement).value || "0") || undefined;
  if (!cmd && !intervalSec && !timeoutSec && !retries) return undefined;
  return { cmd: cmd || undefined, intervalSec, timeoutSec, retries };
}

function parseAndValidateForm(
  name: string,
  image: string,
  portsRaw: string,
  openUrlRaw: string,
  networkRaw: string,
  localDomainRaw: string,
  sourceId?: string,
) {
  if (!name || !image) throw new Error("Name and container image are required.");
  const normalizedName = normalizeName(name);
  if (apps.some((a) => normalizeName(a.name) === normalizedName && a.id !== sourceId)) {
    throw new Error("An app with this name already exists.");
  }
  const ports = parsePortMappings(portsRaw);
  if (ports.some((p) => !isValidPortMapping(p))) {
    throw new Error("Ports must use host:container (1-65535), e.g. 8080:80 or 53:53/udp.");
  }
  const openUrl = validateOpenUrl(openUrlRaw);
  const network = networkRaw.trim() || undefined;
  const localDomain = validateLocalDomain(localDomainRaw);
  if (localDomain && ports.length === 0) {
    throw new Error("Local domain requires at least one published port.");
  }
  if (localDomain && apps.some((a) => a.localDomain === localDomain && a.id !== sourceId)) {
    throw new Error("Another app is already using this local domain.");
  }
  return { ports, openUrl, network, localDomain };
}

function handleNetworkCreate(target: "add" | "edit") {
  const name = promptForNetworkName();
  if (!name) return;
  pendingNetworkSelectTarget = target;
  pendingNetworkName = name;
  send({ type: "network:create", name });
}

// ── IPC message handlers ────────────────────────────────────────

ev.on("ipc-message", (msg: IpcMessage) => {
  switch (msg.type) {
    case "apps:list":
      apps = msg.apps;
      // Mark any installing rec-app buttons as done if now in the list
      for (const [id, btn] of installingRecApps) {
        if (apps.some((a) => a.id === id)) {
          btn.classList.remove("btn-pill--installing");
          btn.classList.add("btn-pill--added");
          btn.textContent = "✓ Added";
          installingRecApps.delete(id);
        }
      }
      // Revert "Added" buttons back to "GET" if the app was uninstalled
      {
        const grid = document.getElementById("store-grid");
        if (grid) {
          for (const btn of grid.querySelectorAll<HTMLButtonElement>("button[data-image].btn-pill--added")) {
            const image = btn.dataset.image;
            if (image && !apps.some((a) => a.image === image)) {
              const fresh = btn.cloneNode(true) as HTMLButtonElement;
              fresh.classList.remove("btn-pill--added");
              fresh.disabled = false;
              fresh.textContent = "GET";
              const app = RECOMMENDED_APPS.find((r) => r.image === image);
              if (app) {
                fresh.addEventListener("click", () => startRecInstall(app, fresh));
              }
              btn.replaceWith(fresh);
            }
          }
        }
      }
      refreshGroupFilterOptions();
      renderGrid();
      break;
    case "networks:listed":
      availableNetworks = [...msg.networks].sort((a, b) => a.localeCompare(b));
      {
        const addSelect = document.getElementById("add-network") as HTMLSelectElement | null;
        const editSelect = document.getElementById("edit-network") as HTMLSelectElement | null;
        const addValue = pendingNetworkSelectTarget === "add" && pendingNetworkName
          ? pendingNetworkName
          : addSelect?.value ?? "";
        const editValue = pendingNetworkSelectTarget === "edit" && pendingNetworkName
          ? pendingNetworkName
          : editSelect?.value ?? "";
        refreshNetworkSelects(addValue, editValue);
      }
      if (pendingNetworkSelectTarget && pendingNetworkName) {
        const selectId = pendingNetworkSelectTarget === "add" ? "add-network" : "edit-network";
        const select = document.getElementById(selectId) as HTMLSelectElement | null;
        if (select && availableNetworks.includes(pendingNetworkName)) {
          select.value = pendingNetworkName;
        }
        pendingNetworkSelectTarget = null;
        pendingNetworkName = null;
      }
      break;
    case "update:state":
      (document.getElementById("release-channel") as HTMLSelectElement).value =
        msg.channel;
      break;
    case "docker:availability":
      podmanAvailable = msg.available;
      setDockerWarningState(
        msg.available
          ? { visible: false }
          : {
              visible: true,
              message: msg.message ?? "Podman is unavailable.",
              detail: msg.detail,
              canRetry: msg.canRetry ?? true,
              canInstall: msg.canInstall ?? true,
            },
      );
      setPodmanInstallPromptVisible(!msg.available);
      break;
    case "onboarding:state":
      firstRun = msg.firstRun;
      dataDir = msg.dataDir;
      systemUid = msg.systemUid;
      systemGid = msg.systemGid;
      systemTz = msg.systemTz;
      updateDataDirDisplays(dataDir);
      renderGrid();
      setPodmanInstallPromptVisible(podmanAvailable === false);
      setRecommendedSectionOpen(msg.firstRun);
      updateOnboardingPodmanCopy(msg.firstRun);
      if (msg.firstRun || msg.showOnboarding) showOnboardingPanel();
      break;
    case "desktop:shortcut:progress": {
      const popup = document.getElementById("desktop-shortcut-popup");
      if (!popup) break;
      if (msg.state === "creating") {
        popup.classList.remove("hidden");
      } else {
        popup.classList.add("hidden");
      }
      break;
    }
    case "app:status": {
      const app = apps.find((a) => a.id === msg.id);
      if (app) {
        app.status = msg.status;
        app.containerId = msg.containerId;
        updateCard(app);
        // Auto-open web UI when container finishes starting (icon-click launch)
        if (msg.status === "running" && pendingWebUiOpen.has(msg.id)) {
          pendingWebUiOpen.delete(msg.id);
          if (app.openUrl) send({ type: "app:open-webui", id: app.id });
        }
        // Clean up pending set if the app errored or was stopped before starting
        if (msg.status === "error" || msg.status === "stopped") {
          pendingWebUiOpen.delete(msg.id);
        }
      }
      break;
    }
    case "app:pull-progress": {
      // Update the installing rec-app button with live pull status
      const installingBtn = installingRecApps.get(msg.id);
      if (installingBtn) {
        const label = (msg.detail ?? msg.status).slice(0, 18);
        installingBtn.textContent = "";
        const sp = document.createElement("span");
        sp.className = "rec-spin";
        installingBtn.appendChild(sp);
        installingBtn.appendChild(document.createTextNode(label));
      }
      showBanner("welcome-banner", `Pulling ${msg.id}: ${msg.detail ?? msg.status}`, 3000);
      break;
    }
    case "error":
      showError(msg.message);
      break;
    case "dockerhub:og-images":
      for (const [image, url] of Object.entries(msg.results)) {
        ogImageCache.set(image, url);
      }
      applyOgImagesFromCache();
      break;
    case "dockerhub:results":
      hubImages = msg.images;
      hubCache.set(msg.query ?? "", msg.images);
      if (hubResultsTarget === "inline") {
        renderHubInlineResults(msg.images, msg.query);
        hubResultsTarget = "modal"; // reset for next use
      } else {
        renderHubResults(msg.query);
      }
      break;
    case "registry:exported": {
      const blob = new Blob([msg.json], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "container-cove-apps.json";
      a.click();
      URL.revokeObjectURL(href);
      break;
    }
    case "update:available":
      pendingUpdateInfo = {
        version: msg.version,
        releaseNotes: msg.releaseNotes,
        downloadUrl: msg.downloadUrl,
        channel: msg.channel,
      };
      setUpdateChip("available", `v${msg.version} available — click to install`);
      break;
    case "update:not-available":
      setUpdateChip("idle");
      showBanner("welcome-banner", "You are on the latest version.", 3000);
      break;
    case "update:download:progress":
      setUpdateChip("downloading", "", msg.percent);
      break;
    case "update:download:done":
      setUpdateChip("ready");
      send({ type: "update:apply", localPath: msg.localPath });
      break;
    case "keychain:set:done":
      showBanner("welcome-banner", `🔑 ${msg.envKey} stored in system keychain.`, 3000);
      break;
    case "keychain:error":
      showError(msg.message);
      break;
    case "settings:state": {
      applyTheme(msg.theme ?? "dark");
      (document.getElementById("toggle-open-at-login") as HTMLInputElement).checked = msg.openAtLogin;
      (document.getElementById("toggle-auto-restart") as HTMLInputElement).checked = msg.autoRestartOnUnhealthy;
      (document.getElementById("toggle-auto-check-updates") as HTMLInputElement).checked = msg.autoCheckUpdates;
      (document.getElementById("toggle-mask-secrets") as HTMLInputElement).checked = msg.secretsMaskingEnabled;
      (document.getElementById("toggle-keychain-secrets") as HTMLInputElement).checked = msg.keychainSecretsEnabled;
      (document.getElementById("toggle-error-logging") as HTMLInputElement).checked = msg.errorLoggingEnabled;
      (document.getElementById("toggle-show-onboarding") as HTMLInputElement).checked = msg.showOnboarding;
      dataDir = msg.dataDir;
      updateDataDirDisplays(dataDir);
      systemUid = msg.systemUid;
      systemGid = msg.systemGid;
      systemTz = msg.systemTz;
      break;
    }
    case "errors:exported": {
      const blob = new Blob([msg.json], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "container-cove-errors.json";
      a.click();
      URL.revokeObjectURL(href);
      break;
    }
    case "dialog:folder-result": {
      if (msg.callbackId === "settings-datadir") {
        dataDir = msg.path;
        updateDataDirDisplays(dataDir);
        send({ type: "settings:data-dir", path: dataDir });
      }
      break;
    }
    case "dialog:folder-cancelled":
      break;
    case "tray:bulk-action-request":
      showTrayBulkActionModal(msg.action);
      break;
    case "app:health-restart":
      showBanner(
        "welcome-banner",
        `↻ Restarting ${msg.name} (unhealthy health check)…`,
        5000,
      );
      break;
    case "notification:show":
      showBanner("welcome-banner", msg.body, 3000);
      break;
    case "system:metrics": {
      const cpuVal = document.getElementById("sys-cpu-val")!;
      const gpuVal = document.getElementById("sys-gpu-val")!;
      const cpuPill = document.getElementById("sys-cpu")!;
      const gpuPill = document.getElementById("sys-gpu")!;

      cpuVal.textContent = `${msg.cpuPercent}%`;
      cpuPill.classList.toggle("sys-metric--high",   msg.cpuPercent >= 80);
      cpuPill.classList.toggle("sys-metric--medium", msg.cpuPercent >= 50 && msg.cpuPercent < 80);
      cpuPill.classList.toggle("sys-metric--low",    msg.cpuPercent <  50);

      if (msg.gpuPercent !== null) {
        gpuVal.textContent = `${msg.gpuPercent}%`;
        gpuPill.classList.toggle("sys-metric--high",   msg.gpuPercent >= 80);
        gpuPill.classList.toggle("sys-metric--medium", msg.gpuPercent >= 50 && msg.gpuPercent < 80);
        gpuPill.classList.toggle("sys-metric--low",    msg.gpuPercent <  50);
      }
      break;
    }
  }
});

// ── Hub rendering ───────────────────────────────────────────────

function renderHubResults(query?: string) {
  const statusEl = document.getElementById("hub-status")!;
  const grid = document.getElementById("hub-grid")!;
  statusEl.textContent = query?.trim()
    ? `Results for "${query}" (${hubImages.length})`
    : `Popular images (${hubImages.length})`;
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  for (const image of hubImages) grid.appendChild(buildHubCard(image, true));
}

// ── Inline hub results (search-bar hub mode) ────────────────────

function renderHubInlineResults(images: DockerHubImage[], query?: string) {
  const statusEl = document.getElementById("hub-inline-status")!;
  const grid = document.getElementById("hub-inline-grid")!;
  statusEl.textContent = query?.trim()
    ? `Docker Hub — "${query}" (${images.length} results)`
    : `50 most popular Docker Hub images`;
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  for (const image of images) {
    // Use closeModal=false so clicking install just opens the add modal without
    // closing a hub modal (there is none in inline mode).
    grid.appendChild(buildHubCard(image, false));
  }
}

function setSearchMode(mode: SearchMode) {
  searchMode = mode;

  const appsBtn = document.getElementById("search-mode-apps") as HTMLButtonElement;
  const hubBtn = document.getElementById("search-mode-hub") as HTMLButtonElement;
  const input = document.getElementById("app-search") as HTMLInputElement;
  const hubSection = document.getElementById("section-hub-inline")!;
  const installedSection = document.getElementById("section-installed")!;
  const recommendedSection = document.getElementById("section-recommended")!;

  if (mode === "apps") {
    appsBtn.classList.add("search-mode-btn--active");
    appsBtn.setAttribute("aria-pressed", "true");
    hubBtn.classList.remove("search-mode-btn--active");
    hubBtn.setAttribute("aria-pressed", "false");

    input.placeholder = "Search installed apps…";

    hubSection.classList.add("hidden");
    installedSection.classList.remove("hidden");
    recommendedSection.classList.remove("hidden");

    // Re-run app filter in case query carries over
    searchTerm = input.value;
    renderGrid();
  } else {
    hubBtn.classList.add("search-mode-btn--active");
    hubBtn.setAttribute("aria-pressed", "true");
    appsBtn.classList.remove("search-mode-btn--active");
    appsBtn.setAttribute("aria-pressed", "false");

    input.placeholder = "Search Docker Hub…";

    hubSection.classList.remove("hidden");
    installedSection.classList.add("hidden");
    recommendedSection.classList.add("hidden");

    // Show popular images immediately (or from cache) when no query is typed
    const query = input.value.trim();
    const cacheKey = query || "";
    const cached = hubCache.get(cacheKey);
    if (cached) {
      // Render cached results straight into the inline panel
      renderHubInlineResults(cached, query || undefined);
    } else {
      document.getElementById("hub-inline-status")!.textContent = query
        ? `Searching "${query}"…`
        : "Loading 50 most popular images…";
      hubResultsTarget = "inline";
      send({ type: "dockerhub:browse", query: query || undefined });
    }
  }
}

function fillAddFromRec(app: RecommendedApp) {
  (document.getElementById("add-name") as HTMLInputElement).value = app.name;
  (document.getElementById("add-image") as HTMLInputElement).value = app.image;
  (document.getElementById("add-ports") as HTMLInputElement).value = (app.ports ?? []).join(", ");
  (document.getElementById("add-url") as HTMLInputElement).value = app.openUrl ?? "";
  (document.getElementById("add-restart") as HTMLSelectElement).value = app.restartPolicy ?? "no";
  (document.getElementById("add-health-cmd") as HTMLInputElement).value = "";
  (document.getElementById("add-health-interval") as HTMLInputElement).value = "";
  (document.getElementById("add-health-timeout") as HTMLInputElement).value = "";
  (document.getElementById("add-health-retries") as HTMLInputElement).value = "";
  (document.getElementById("add-group") as HTMLInputElement).value = app.category;
  populateNetworkSelect("add-network", "");
  (document.getElementById("add-local-domain") as HTMLInputElement).value = "";
  buildEnvTable("add-env-table", app.env ?? {});
  buildVolTable("add-vol-table", app.volumes ?? []);
}

function buildRecCard(app: RecommendedApp): HTMLElement {
  const card = document.createElement("div");
  card.className = "rec-card";

  // Icon square — use Dashboard Icons CDN if slug is available, else emoji
  const icon = document.createElement("div");
  icon.className = "rec-card__icon";

  const iconSrc = app.iconUrl
    ? app.iconUrl
    : app.iconSlug
      ? `${ICON_CDN}/${app.iconSlug}.png`
      : null;
  if (iconSrc) {
    const img = document.createElement("img");
    img.className = app.iconFill ? "rec-card__logo rec-card__logo--fill" : "rec-card__logo";
    img.src = iconSrc;
    img.alt = app.name;
    img.addEventListener("error", () => {
      img.remove();
      icon.textContent = app.icon;
    });
    icon.appendChild(img);
  } else {
    icon.textContent = app.icon;
  }

  // Info column
  const info = document.createElement("div");
  info.className = "app-card__info";

  const name = document.createElement("div");
  name.className = "app-card__name";
  name.textContent = app.name;

  const desc = document.createElement("div");
  desc.className = "app-card__sub app-card__sub--desc";
  desc.textContent = app.description;

  info.appendChild(name);
  info.appendChild(desc);

  // CTA column
  const cta = document.createElement("div");
  cta.className = "app-card__cta";

  const btn = document.createElement("button");
  btn.className = "btn-pill";
  btn.dataset.image = app.image;

  const alreadyInstalled = apps.some((a) => a.image === app.image);
  if (alreadyInstalled) {
    setRecBtnInstalled(btn);
  } else {
    btn.textContent = "GET";
    btn.addEventListener("click", () => startRecInstall(app, btn));
  }

  cta.appendChild(btn);

  card.appendChild(icon);
  card.appendChild(info);
  card.appendChild(cta);
  return card;
}

function renderRecommendedApps() {
  const grid = document.getElementById("store-grid")!;
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  let currentCategory = "";
  for (const app of RECOMMENDED_APPS) {
    if (app.category !== currentCategory) {
      currentCategory = app.category;
      const header = document.createElement("div");
      header.className = "rec-category-header";
      header.textContent = app.category;
      grid.appendChild(header);
    }
    grid.appendChild(buildRecCard(app));
  }
}

function renderHubMeta(image: DockerHubImage, display: string) {
  const meta = document.getElementById("hub-meta")!;
  const preset = presetForImage(display);
  meta.classList.remove("hidden");
  meta.innerHTML =
    `<h3>${display}</h3>` +
    `<p>${image.description || "No description"}</p>` +
    `<p><strong>Stars:</strong> ${image.starCount.toLocaleString()} | <strong>Pulls:</strong> ${image.pullCount.toLocaleString()}</p>` +
    `<p><a href="https://hub.docker.com/r/${image.fullName}" target="_blank">View docs on Docker Hub</a></p>` +
    (preset
      ? `<p><strong>Preset:</strong> Ports ${preset.ports.join(", ") || "none"}, Restart ${preset.restartPolicy || "no"}</p>`
      : `<p><strong>Preset:</strong> none</p>`);
}

function fillAddFromImage(image: DockerHubImage, display: string) {
  const preset = presetForImage(display);
  (document.getElementById("add-name") as HTMLInputElement).value = preset?.suggestedName ?? image.name;
  (document.getElementById("add-image") as HTMLInputElement).value = display;
  (document.getElementById("add-ports") as HTMLInputElement).value = preset?.ports.join(", ") ?? "";
  (document.getElementById("add-url") as HTMLInputElement).value = preset?.openUrl ?? "";
  (document.getElementById("add-restart") as HTMLSelectElement).value = preset?.restartPolicy ?? "no";
  (document.getElementById("add-health-cmd") as HTMLInputElement).value = preset?.healthcheck?.cmd ?? "";
  (document.getElementById("add-health-interval") as HTMLInputElement).value =
    preset?.healthcheck?.intervalSec?.toString() ?? "";
  (document.getElementById("add-health-timeout") as HTMLInputElement).value =
    preset?.healthcheck?.timeoutSec?.toString() ?? "";
  (document.getElementById("add-health-retries") as HTMLInputElement).value =
    preset?.healthcheck?.retries?.toString() ?? "";
  (document.getElementById("add-group") as HTMLInputElement).value =
    preset?.suggestedName?.toLowerCase().includes("db") ? "databases" : "";
  populateNetworkSelect("add-network", "");
  (document.getElementById("add-local-domain") as HTMLInputElement).value = "";
  buildEnvTable("add-env-table", {});
  buildVolTable("add-vol-table", []);
}

function buildHubCard(image: DockerHubImage, closeModal: boolean): HTMLElement {
  const card = document.createElement("div");
  card.className = "hub-card";
  const display = image.isOfficial ? image.name : image.fullName;
  card.innerHTML = buildHubCardHTML(image, display);
  // Details button is now a direct link to Docker Hub (opens in new tab)
  card.querySelector("[data-action='install']")?.addEventListener("click", () => {
    fillAddFromImage(image, display);
    if (closeModal) document.getElementById("modal-hub")!.classList.add("hidden");
    document.getElementById("modal-add")!.classList.remove("hidden");
  });
  return card;
}

// ── Add modal ───────────────────────────────────────────────────

let addModalTab: "app" | "compose" = "app";

function switchAddTab(tab: "app" | "compose") {
  addModalTab = tab;
  document.querySelectorAll<HTMLElement>(".modal-tab").forEach((btn) => {
    btn.classList.toggle("modal-tab--active", btn.dataset.tab === tab);
  });
  document.getElementById("add-tab-app")!.classList.toggle("hidden", tab !== "app");
  document.getElementById("add-tab-compose")!.classList.toggle("hidden", tab !== "compose");
  (document.getElementById("btn-add-confirm") as HTMLButtonElement).textContent =
    tab === "compose" ? "Import" : "Add";
}

document.querySelectorAll<HTMLElement>(".modal-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchAddTab(btn.dataset.tab as "app" | "compose"));
});

document.getElementById("btn-add")!.addEventListener("click", () => {
  switchAddTab("app");
  buildEnvTable("add-env-table", {});
  buildVolTable("add-vol-table", []);
  populateNetworkSelect("add-network", "");
  (document.getElementById("add-local-domain") as HTMLInputElement).value = "";
  document.getElementById("modal-add")!.classList.remove("hidden");
  requestNetworksList();
});
document.getElementById("btn-add-cancel")!.addEventListener("click", () => {
  document.getElementById("modal-add")!.classList.add("hidden");
});
document.getElementById("add-env-add-row")!.addEventListener("click", () => {
  addEnvRow(document.getElementById("add-env-table")!);
});
document.getElementById("add-vol-add-row")!.addEventListener("click", () => {
  addVolRow(document.getElementById("add-vol-table")!);
});
document.getElementById("add-network-create")!.addEventListener("click", () => {
  handleNetworkCreate("add");
});
document.getElementById("btn-add-confirm")!.addEventListener("click", () => {
  if (addModalTab === "compose") {
    const projectName = (document.getElementById("add-compose-project") as HTMLInputElement).value.trim();
    const yaml = (document.getElementById("add-compose-yaml") as HTMLTextAreaElement).value.trim();
    if (!yaml) { showError("Compose YAML is required."); return; }
    send({ type: "compose:import", yaml, projectName: projectName || undefined });
    document.getElementById("modal-add")!.classList.add("hidden");
    return;
  }
  try {
    const name = (document.getElementById("add-name") as HTMLInputElement).value.trim();
    const image = (document.getElementById("add-image") as HTMLInputElement).value.trim();
    const portsRaw = (document.getElementById("add-ports") as HTMLInputElement).value.trim();
    const openUrlRaw = (document.getElementById("add-url") as HTMLInputElement).value.trim();
    const restartPolicy = (document.getElementById("add-restart") as HTMLSelectElement)
      .value as DockerApp["restartPolicy"];
    const group = (document.getElementById("add-group") as HTMLInputElement).value.trim();
    const network = (document.getElementById("add-network") as HTMLSelectElement).value;
    const localDomainRaw = (document.getElementById("add-local-domain") as HTMLInputElement).value;
    const healthcheck = parseHealth("add");
    const { env, keychainKeys } = readEnvTable("add-env-table");
    const volumes = readVolTable("add-vol-table");
    const { ports, openUrl, network: selectedNetwork, localDomain } =
      parseAndValidateForm(name, image, portsRaw, openUrlRaw, network, localDomainRaw);
    const appId = generateAppId(name);
    send({
      type: "app:add",
      app: {
        id: appId,
        name,
        image,
        icon: "default.png",
        description: image,
        ports,
        env,
        volumes,
        openUrl,
        group: group || undefined,
        restartPolicy,
        network: selectedNetwork,
        localDomain,
        keychainEnvKeys: keychainKeys.length ? keychainKeys : undefined,
      },
    });
    for (const k of keychainKeys) {
      if (env[k]) send({ type: "keychain:set", appId, envKey: k, value: env[k] });
    }
    document.getElementById("modal-add")!.classList.add("hidden");
  } catch (err) {
    showError(String(err));
  }
});

// ── Edit modal ──────────────────────────────────────────────────

function closeEditModal() {
  if (deleteConfirmTimer) { clearTimeout(deleteConfirmTimer); deleteConfirmTimer = null; }
  btnEditDelete.classList.remove("btn--confirming");
  btnEditDelete.textContent = "Delete";
  document.getElementById("modal-edit")!.classList.add("hidden");
  editTarget = null;
}
document.getElementById("btn-edit-cancel")!.addEventListener("click", closeEditModal);
document.getElementById("btn-edit-stop")!.addEventListener("click", () => {
  if (!editTarget) return;
  send({ type: "app:stop", id: editTarget.id });
  closeEditModal();
});
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null;
const btnEditDelete = document.getElementById("btn-edit-delete") as HTMLButtonElement;
btnEditDelete.addEventListener("click", () => {
  if (!editTarget) return;

  if (!btnEditDelete.classList.contains("btn--confirming")) {
    // First click — enter confirmation state
    btnEditDelete.classList.add("btn--confirming");
    btnEditDelete.textContent = "Are You Sure?";
    deleteConfirmTimer = setTimeout(() => {
      btnEditDelete.classList.remove("btn--confirming");
      btnEditDelete.textContent = "Delete";
    }, 3000);
    return;
  }

  // Second click — confirmed, execute delete
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
  btnEditDelete.classList.remove("btn--confirming");
  btnEditDelete.textContent = "Delete";
  send({ type: "app:remove", id: editTarget.id });
  document.getElementById("modal-edit")!.classList.add("hidden");
  editTarget = null;
});
document.getElementById("edit-env-add-row")!.addEventListener("click", () => {
  addEnvRow(document.getElementById("edit-env-table")!);
});
document.getElementById("edit-vol-add-row")!.addEventListener("click", () => {
  addVolRow(document.getElementById("edit-vol-table")!);
});
document.getElementById("edit-network-create")!.addEventListener("click", () => {
  handleNetworkCreate("edit");
});
document.getElementById("btn-edit-confirm")!.addEventListener("click", () => {
  if (!editTarget) return;
  try {
    const name = (document.getElementById("edit-name") as HTMLInputElement).value.trim();
    const image = (document.getElementById("edit-image") as HTMLInputElement).value.trim();
    const portsRaw = (document.getElementById("edit-ports") as HTMLInputElement).value.trim();
    const openUrlRaw = (document.getElementById("edit-url") as HTMLInputElement).value.trim();
    const restartPolicy = (document.getElementById("edit-restart") as HTMLSelectElement)
      .value as DockerApp["restartPolicy"];
    const group = (document.getElementById("edit-group") as HTMLInputElement).value.trim();
    const network = (document.getElementById("edit-network") as HTMLSelectElement).value;
    const localDomainRaw = (document.getElementById("edit-local-domain") as HTMLInputElement).value;
    const { env, keychainKeys } = readEnvTable("edit-env-table");
    const volumes = readVolTable("edit-vol-table");
    const { ports, openUrl, network: selectedNetwork, localDomain } =
      parseAndValidateForm(name, image, portsRaw, openUrlRaw, network, localDomainRaw, editTarget.id);
    const appId = editTarget.id;
    send({
      type: "app:update",
      app: {
        ...editTarget,
        name,
        image,
        description: image,
        ports,
        env,
        volumes,
        openUrl,
        group: group || undefined,
        restartPolicy,
        network: selectedNetwork,
        localDomain,
        keychainEnvKeys: keychainKeys.length ? keychainKeys : undefined,
      },
    });
    // Sync keychain: set newly-checked keys, delete unchecked ones
    const previousKeychainKeys = editTarget.keychainEnvKeys ?? [];
    for (const k of keychainKeys) {
      if (env[k]) send({ type: "keychain:set", appId, envKey: k, value: env[k] });
    }
    for (const k of previousKeychainKeys) {
      if (!keychainKeys.includes(k)) {
        send({ type: "keychain:delete", appId, envKey: k });
      }
    }
    document.getElementById("modal-edit")!.classList.add("hidden");
    editTarget = null;
  } catch (err) {
    showError(String(err));
  }
});

// ── Filters & toolbar ───────────────────────────────────────────

document.getElementById("btn-check-update")?.addEventListener("click", () => {
  send({ type: "docker:start-if-needed" });
  send({ type: "update:check" });
  setUpdateChip("checking");
});
document.getElementById("btn-onboarding-dismiss")?.addEventListener("click", () => {
  const noStartup = (document.getElementById("onboarding-no-startup") as HTMLInputElement)?.checked ?? false;
  send({ type: "onboarding:dismiss", noStartup });
  hideOnboardingPanel();
});
document.getElementById("btn-onboarding-skip")?.addEventListener("click", () => {
  const noStartup = (document.getElementById("onboarding-no-startup") as HTMLInputElement)?.checked ?? false;
  send({ type: "onboarding:dismiss", noStartup });
  hideOnboardingPanel();
});
document.getElementById("tray-confirm-cancel")?.addEventListener("click", hideTrayBulkActionModal);
document.getElementById("tray-confirm-modal")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    hideTrayBulkActionModal();
  }
});
document.getElementById("tray-confirm-accept")?.addEventListener("click", () => {
  if (!pendingTrayBulkAction) return;
  send({ type: "tray:bulk-action-confirm", action: pendingTrayBulkAction });
  hideTrayBulkActionModal();
});
document.getElementById("onboarding-panel")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    const noStartup = (document.getElementById("onboarding-no-startup") as HTMLInputElement)?.checked ?? false;
    send({ type: "onboarding:dismiss", noStartup });
    hideOnboardingPanel();
  }
});

// ── Import / export ─────────────────────────────────────────────

document.getElementById("btn-export-registry")!.addEventListener("click", () => {
  send({ type: "registry:export" });
});
document.getElementById("btn-docker-retry")?.addEventListener("click", () => {
  send({ type: "docker:retry" });
});
document.getElementById("btn-docker-install")?.addEventListener("click", () => {
  send({ type: "podman:install" });
});
document.getElementById("btn-onboarding-install-podman")?.addEventListener("click", () => {
  send({ type: "podman:install" });
});
document.getElementById("btn-import-registry")!.addEventListener("click", () => {
  (document.getElementById("registry-import-file") as HTMLInputElement).click();
});
document.getElementById("registry-import-file")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const json = await file.text();
  send({ type: "registry:import", json });
});

// Settings modal open / close
document.getElementById("btn-settings")!.addEventListener("click", () => {
  document.getElementById("modal-settings")!.classList.remove("hidden");
});
document.getElementById("btn-settings-close")!.addEventListener("click", () => {
  document.getElementById("modal-settings")!.classList.add("hidden");
});
document.getElementById("modal-settings")!.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    (e.currentTarget as HTMLElement).classList.add("hidden");
});

// Restart toast undo
document.getElementById("restart-toast-undo")?.addEventListener("click", () => {
  if (pendingRestartTimeout) {
    clearTimeout(pendingRestartTimeout);
    pendingRestartTimeout = null;
    pendingRestartId = null;
  }
  document.getElementById("restart-toast")?.classList.add("hidden");
  showBanner("welcome-banner", "Restart cancelled", 2000);
});

// Settings toggles
document.getElementById("toggle-open-at-login")!.addEventListener("change", (e) => {
  send({ type: "settings:open-at-login", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("toggle-auto-restart")!.addEventListener("change", (e) => {
  send({ type: "settings:auto-restart", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("toggle-auto-check-updates")!.addEventListener("change", (e) => {
  send({ type: "settings:auto-check-updates", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("toggle-mask-secrets")!.addEventListener("change", (e) => {
  send({ type: "secrets:mask", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("toggle-keychain-secrets")!.addEventListener("change", (e) => {
  send({ type: "secrets:keychain", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("toggle-error-logging")!.addEventListener("change", (e) => {
  send({ type: "settings:error-logging", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("toggle-show-onboarding")!.addEventListener("change", (e) => {
  send({ type: "settings:show-onboarding", enabled: (e.target as HTMLInputElement).checked });
});
document.getElementById("release-channel")!.addEventListener("change", (e) => {
  const channel = (e.target as HTMLSelectElement).value as "stable" | "beta";
  send({ type: "update:channel:set", channel });
});
document.getElementById("btn-settings-pick-dir")!.addEventListener("click", () => {
  send({ type: "dialog:pick-folder", callbackId: "settings-datadir" });
});
document.getElementById("app-search")!.addEventListener("input", (e) => {
  const value = (e.target as HTMLInputElement).value;
  if (searchDebounce) clearTimeout(searchDebounce);

  if (searchMode === "hub") {
    searchDebounce = setTimeout(() => {
      const query = value.trim();
      const cached = hubCache.get(query || "");
      if (cached) {
        renderHubInlineResults(cached, query || undefined);
      } else {
        document.getElementById("hub-inline-status")!.textContent = query
          ? `Searching "${query}"…`
          : "Loading popular images…";
        hubResultsTarget = "inline";
        send({ type: "dockerhub:browse", query: query || undefined });
      }
    }, 350);
  } else {
    searchDebounce = setTimeout(() => {
      searchTerm = value;
      renderGrid();
    }, 120);
  }
});

// ── Search mode toggle buttons ───────────────────────────────────

document.getElementById("search-mode-apps")!.addEventListener("click", () => {
  if (searchMode !== "apps") setSearchMode("apps");
});
document.getElementById("search-mode-hub")!.addEventListener("click", () => {
  if (searchMode !== "hub") setSearchMode("hub");
});

// ── Docker Hub ──────────────────────────────────────────────────

document.getElementById("btn-hub")!.addEventListener("click", () => {
  document.getElementById("modal-hub")!.classList.remove("hidden");
  const cached = hubCache.get("");
  if (cached) {
    hubImages = cached;
    renderHubResults(undefined);
  } else {
    document.getElementById("hub-status")!.textContent = "Loading popular images...";
    hubResultsTarget = "modal";
    send({ type: "dockerhub:browse" });
  }
});
document.getElementById("btn-hub-close")!.addEventListener("click", () => {
  document.getElementById("modal-hub")!.classList.add("hidden");
});
document.getElementById("btn-hub-popular")!.addEventListener("click", () => {
  const cached = hubCache.get("");
  if (cached) {
    hubImages = cached;
    renderHubResults(undefined);
  } else {
    document.getElementById("hub-status")!.textContent = "Loading popular images...";
    hubResultsTarget = "modal";
    send({ type: "dockerhub:browse" });
  }
});
document.getElementById("btn-hub-search")!.addEventListener("click", () => {
  const query = (document.getElementById("hub-search") as HTMLInputElement).value.trim();
  const cached = query ? hubCache.get(query) : hubCache.get("");
  if (cached) {
    hubImages = cached;
    renderHubResults(query || undefined);
    return;
  }
  document.getElementById("hub-status")!.textContent = query
    ? `Searching "${query}"...`
    : "Loading popular images...";
  hubResultsTarget = "modal";
  send({ type: "dockerhub:browse", query: query || undefined });
});
document.getElementById("hub-search")!.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  (document.getElementById("btn-hub-search") as HTMLButtonElement).click();
});

// Render the static recommended apps catalogue on load.
// Wrap in DOMContentLoaded so the grid element is always ready
// regardless of how Electrobun's webview schedules module evaluation.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderRecommendedApps);
} else {
  renderRecommendedApps();
}
