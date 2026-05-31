import type { DockerHubImage } from "../shared/types";

// ── OG image fetching ────────────────────────────────────────────

/**
 * Returns the Docker Hub repository page URL for a given image reference,
 * or null for non-Hub registries (ghcr.io, gcr.io, etc.).
 */
function hubPageUrl(image: string): string | null {
  const withoutTag = image.split(":")[0];
  // LinuxServer images mirror to Docker Hub
  if (withoutTag.startsWith("lscr.io/linuxserver/")) {
    const repo = withoutTag.replace("lscr.io/linuxserver/", "");
    return `https://hub.docker.com/r/linuxserver/${repo}`;
  }
  // Other external registries — no Hub page
  if (withoutTag.includes(".io/") || withoutTag.includes(".com/") || withoutTag.includes(".org/")) {
    return null;
  }
  const parts = withoutTag.split("/");
  if (parts.length === 1) return `https://hub.docker.com/_/${parts[0]}`;
  return `https://hub.docker.com/r/${parts[0]}/${parts[1]}`;
}

/** Fetch the og:image URL from a Docker Hub repository page. */
export async function fetchOgImage(image: string): Promise<string | null> {
  const pageUrl = hubPageUrl(image);
  if (!pageUrl) return null;
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; The Loading Dock(r)/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Fetch og:image URLs for multiple image references in parallel (batched). */
export async function fetchAllOgImages(
  images: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(images)];
  const results: Record<string, string> = {};
  const BATCH = 6;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (image) => ({ image, url: await fetchOgImage(image) })),
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value.url) {
        results[r.value.image] = r.value.url;
      }
    }
  }
  return results;
}

type DockerHubResult = {
  repo_name: string;
  short_description?: string;
  star_count?: number;
  pull_count?: number;
  is_official?: boolean;
};

type DockerHubResponse = {
  results?: DockerHubResult[];
};

function mapImage(row: DockerHubResult): DockerHubImage {
  const parts = (row.repo_name ?? "").split("/");
  const name = parts.length >= 2 ? parts[1] : parts[0];
  const namespace = parts.length >= 2 ? parts[0] : "library";
  return {
    name,
    namespace,
    fullName: `${namespace}/${name}`,
    description: row.short_description ?? "",
    starCount: row.star_count ?? 0,
    pullCount: row.pull_count ?? 0,
    isOfficial: Boolean(row.is_official || namespace === "library"),
  };
}

async function fetchHub(url: string): Promise<DockerHubImage[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Docker Hub request failed (${res.status})`);
  const body = (await res.json()) as DockerHubResponse;
  const rows = body.results ?? [];
  return rows.map(mapImage);
}

export async function getPopularImages(limit = 50): Promise<DockerHubImage[]> {
  const url = `https://hub.docker.com/v2/search/repositories/?page=1&page_size=${limit}&query=*&ordering=-pull_count&is_official=true`;
  return fetchHub(url);
}

export async function searchImages(
  query: string,
  limit = 24,
): Promise<DockerHubImage[]> {
  const q = query.trim();
  if (!q) return getPopularImages(limit);
  const url = `https://hub.docker.com/v2/search/repositories/?page=1&page_size=${limit}&query=${encodeURIComponent(q)}&ordering=-pull_count`;
  return fetchHub(url);
}
