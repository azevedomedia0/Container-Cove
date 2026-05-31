// src/main/updater.ts
import { join } from "path";
import { tmpdir } from "os";

export interface ReleaseInfo {
  version: string;
  releaseNotes: string;
  downloadUrl: string;
  channel: "stable" | "beta";
}

export type UpdaterCallback =
  | { type: "available"; info: ReleaseInfo }
  | { type: "not-available" }
  | { type: "progress"; percent: number }
  | { type: "ready"; localPath: string }
  | { type: "error"; message: string };

const GITHUB_OWNER = "stevenazevedodesign";
const GITHUB_REPO = "container-cove";
const API_BASE = "https://api.github.com";

function platformSuffix(): string {
  if (process.platform === "darwin")
    return process.arch === "arm64" ? "mac-arm64.zip" : "mac-x64.zip";
  if (process.platform === "win32") return "win-x64.exe";
  return "linux-x64.AppImage";
}

function parseVersion(v: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = v
    .replace(/^v/, "")
    .split(".")
    .map(Number);
  return [major, minor, patch];
}

export function isNewer(remote: string, local: string): boolean {
  const [rMaj, rMin, rPat] = parseVersion(remote);
  const [lMaj, lMin, lPat] = parseVersion(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

async function fetchLatestRelease(
  channel: "stable" | "beta",
): Promise<{ tag: string; body: string; assets: { name: string; url: string }[] } | null> {
  const url =
    channel === "beta"
      ? `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=5`
      : `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "container-cove-updater",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;

  if (channel === "beta") {
    const list = (await res.json()) as {
      tag_name: string;
      prerelease: boolean;
      body: string;
      assets: { name: string; browser_download_url: string }[];
    }[];
    const release = list.find((r) => r.prerelease) ?? list[0];
    if (!release) return null;
    return {
      tag: release.tag_name,
      body: release.body,
      assets: release.assets.map((a) => ({
        name: a.name,
        url: a.browser_download_url,
      })),
    };
  }

  const release = (await res.json()) as {
    tag_name: string;
    body: string;
    assets: { name: string; browser_download_url: string }[];
  };
  return {
    tag: release.tag_name,
    body: release.body,
    assets: release.assets.map((a) => ({
      name: a.name,
      url: a.browser_download_url,
    })),
  };
}

export async function checkForUpdate(
  currentVersion: string,
  channel: "stable" | "beta",
  onResult: (result: UpdaterCallback) => void,
): Promise<void> {
  try {
    const release = await fetchLatestRelease(channel);
    if (!release) {
      onResult({ type: "not-available" });
      return;
    }

    const suffix = platformSuffix();
    const asset = release.assets.find((a) => a.name.endsWith(suffix));
    if (!asset || !isNewer(release.tag, currentVersion)) {
      onResult({ type: "not-available" });
      return;
    }

    onResult({
      type: "available",
      info: {
        version: release.tag.replace(/^v/, ""),
        releaseNotes: release.body ?? "",
        downloadUrl: asset.url,
        channel,
      },
    });
  } catch (err) {
    onResult({ type: "error", message: String(err) });
  }
}

export async function downloadUpdate(
  info: ReleaseInfo,
  onResult: (result: UpdaterCallback) => void,
): Promise<void> {
  try {
    const dest = join(tmpdir(), `container-cove-update-${info.version}`);
    const res = await fetch(info.downloadUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) {
      onResult({ type: "error", message: `Download failed: HTTP ${res.status}` });
      return;
    }

    const contentLength = Number(res.headers.get("content-length") ?? "0");
    let received = 0;
    const chunks: Uint8Array[] = [];

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (contentLength > 0) {
        onResult({
          type: "progress",
          percent: Math.round((received / contentLength) * 100),
        });
      }
    }

    const data = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await Bun.write(dest, data);
    onResult({ type: "ready", localPath: dest });
  } catch (err) {
    onResult({ type: "error", message: String(err) });
  }
}

export async function applyUpdate(localPath: string): Promise<void> {
  if (process.platform === "darwin") {
    Bun.spawn(["open", localPath]);
  } else if (process.platform === "win32") {
    Bun.spawn([localPath, "/silent", "/restart"], { detached: true });
  } else {
    Bun.spawn(["chmod", "+x", localPath]).exited.then(() =>
      Bun.spawn([localPath, "--no-sandbox"]),
    );
  }
  setTimeout(() => process.exit(0), 1500);
}
