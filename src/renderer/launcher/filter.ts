// src/renderer/launcher/filter.ts — pure functions extracted for testability
import type { DockerApp, DockerHubImage } from "../../shared/types";

export function filterApps(
  apps: DockerApp[],
  searchTerm: string,
  statusFilter: string,
  groupFilter: string,
): DockerApp[] {
  const term = searchTerm.trim().toLowerCase();
  return apps.filter((app) => {
    const termOk =
      !term ||
      app.name.toLowerCase().includes(term) ||
      app.image.toLowerCase().includes(term) ||
      app.description.toLowerCase().includes(term);
    const statusOk = statusFilter === "all" || app.status === statusFilter;
    const groupOk =
      groupFilter === "all" ||
      (app.group?.trim() || "ungrouped") === groupFilter;
    return termOk && statusOk && groupOk;
  });
}

export function collectGroups(apps: DockerApp[]): string[] {
  return Array.from(
    new Set(
      apps.map((a) => (a.group && a.group.trim() ? a.group.trim() : "ungrouped")),
    ),
  ).sort();
}

const ICON_CDN =
  "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@main/png";

/**
 * Derive a Dashboard Icons slug from a Docker image reference.
 * e.g. "lscr.io/linuxserver/plex:latest" → "plex"
 *      "ghcr.io/home-assistant/home-assistant:stable" → "home-assistant"
 */
function iconSlugFromImage(image: string): string {
  // Strip registry (anything with a dot before the first slash)
  let slug = image.replace(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+(:\d+)?\//, "");
  // Strip tag / digest
  slug = slug.split(":")[0].split("@")[0];
  // Take the last path segment
  slug = slug.split("/").pop() ?? slug;
  return slug;
}

// Deterministic gradient per app name
const ICON_GRADIENTS: [string, string][] = [
  ["#3b82f6", "#1d4ed8"], // blue
  ["#10b981", "#059669"], // green
  ["#f59e0b", "#b45309"], // amber
  ["#ef4444", "#b91c1c"], // red
  ["#8b5cf6", "#6d28d9"], // purple
  ["#06b6d4", "#0e7490"], // cyan
  ["#f97316", "#c2410c"], // orange
  ["#ec4899", "#be185d"], // pink
];

function appIconStyle(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  const [a, b] = ICON_GRADIENTS[h % ICON_GRADIENTS.length];
  return `background:linear-gradient(135deg,${a},${b})`;
}

function appInitials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function buildCardHTML(app: DockerApp, hasImageUpdate = false): string {
  const isRunning = app.status === "running";
  const busy = app.status === "starting" || app.status === "stopping";
  const dot = `<span class="status-dot status-dot--${app.status}"></span>`;
  const statusLabels: Record<string, string> = { stopped: "Offline" };
  const label = statusLabels[app.status] ?? (app.status.charAt(0).toUpperCase() + app.status.slice(1));
  const actionAttr = isRunning ? "open" : "launch";
  const iconTitle = isRunning ? (app.openUrl ? "Open Web UI" : "View") : "Launch";
  const disabledAttr = busy ? " data-busy='true'" : "";
  const updateBadge = hasImageUpdate
    ? `<span class="app-card__update-badge" title="A newer image is available on Docker Hub">↑ Update</span>`
    : "";

  // Icon: custom URL > explicit slug > image-derived slug; overlay on gradient+initials fallback
  const resolvedSlug = app.iconSlug || iconSlugFromImage(app.image);
  const iconSrc = app.iconUrl
    ? app.iconUrl
    : resolvedSlug
      ? `${ICON_CDN}/${resolvedSlug}.png`
      : null;
  const cdnImg = iconSrc
    ? `<img class="app-card__og-img" src="${iconSrc}" alt="" onerror="this.style.display='none'" />`
    : "";

  return (
    `<div class="app-card__icon app-card__icon--clickable" style="${appIconStyle(app.name)}" data-app-image="${app.image.replace(/"/g, "&quot;")}" data-action="${actionAttr}" title="${iconTitle}"${disabledAttr}>${cdnImg}</div>` +
    `<div class="app-card__info">` +
    `<div class="app-card__name">${app.name}${updateBadge}</div>` +
    `<div class="app-card__status-row">${dot}<span class="status-label status-label--${app.status}">${label}</span>${isRunning ? `<button class="app-card__settings-btn" data-action="restart" title="Restart"><i class="iconoir-refresh-circular"></i></button>` : ""}<button class="app-card__settings-btn" data-action="edit" title="Settings"><svg width="14" height="14" stroke-width="2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L21.9999 12.9772L22 11L19.6224 10.3954Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>` +
    `</div>`
  );
}

export function buildHubCardHTML(
  image: DockerHubImage,
  display: string,
): string {
  const initials = appInitials(display);
  const badge = image.isOfficial
    ? `<span class="hub-card__badge">Official</span>`
    : "";
  return (
    `<div class="hub-card__header">` +
      `<div class="hub-card__icon">` +
        `<img class="hub-card__og-img"` +
          ` src="${ICON_CDN}/${image.name}.png"` +
          ` data-favicon="https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${image.name}.com&size=128"` +
          ` alt=""` +
          ` onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src=this.dataset.favicon;}else{this.style.display='none';this.nextElementSibling.style.display='';}"` +
        ` />` +
        `<span style="display:none">${initials}</span>` +
      `</div>` +
      `<div class="hub-card__name-block">` +
        `<div class="hub-card__title">${display}${badge}</div>` +
        `<div class="hub-card__meta">★ ${image.starCount.toLocaleString()} · ${image.pullCount.toLocaleString()} pulls</div>` +
      `</div>` +
    `</div>` +
    `<div class="hub-card__desc">${(image.description || "No description").slice(0, 120)}</div>` +
    `<div class="hub-actions"><button class="btn btn--ghost" data-action="details">Details</button><button class="btn btn--primary" data-action="install">Install</button></div>`
  );
}
