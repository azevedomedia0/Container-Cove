import { describe, expect, test } from "bun:test";
import type { DockerApp, DockerHubImage } from "../../shared/types";
import {
  buildCardHTML,
  buildHubCardHTML,
  collectGroups,
  filterApps,
} from "./filter";

const base: DockerApp = {
  id: "pg",
  name: "Postgres",
  icon: "postgres.png",
  description: "PostgreSQL database",
  image: "postgres:15",
  ports: ["5432:5432"],
  env: {},
  volumes: [],
  status: "stopped",
};

const running: DockerApp = {
  ...base,
  id: "redis",
  name: "Redis",
  icon: "redis.png",
  description: "In-memory store",
  image: "redis:7",
  status: "running",
  group: "caches",

};

const errorApp: DockerApp = {
  ...base,
  id: "broken",
  name: "Broken",
  image: "broken:latest",
  description: "Broken app",
  status: "error",
  group: "ungrouped",
};

describe("filterApps", () => {
  const all = [base, running, errorApp];

  test("empty term / all / all returns everything", () => {
    expect(filterApps(all, "", "all", "all")).toHaveLength(3);
  });

  test("filters by name (case-insensitive)", () => {
    const r = filterApps(all, "REDIS", "all", "all");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("redis");
  });

  test("filters by image name", () => {
    const r = filterApps(all, "postgres:15", "all", "all");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("pg");
  });

  test("filters by description", () => {
    const r = filterApps(all, "in-memory", "all", "all");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("redis");
  });

  test("status filter: running", () => {
    const r = filterApps(all, "", "running", "all");
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("running");
  });

  test("status filter: error", () => {
    const r = filterApps(all, "", "error", "all");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("broken");
  });

  test("group filter: caches", () => {
    const r = filterApps(all, "", "all", "caches");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("redis");
  });

  test("group filter: ungrouped catches apps without group", () => {
    // pg has no group → treated as 'ungrouped'
    const r = filterApps(all, "", "all", "ungrouped");
    expect(r.map((a) => a.id)).toContain("pg");
    expect(r.map((a) => a.id)).toContain("broken");
  });

  test("term + status combo narrows correctly", () => {
    const r = filterApps(all, "redis", "running", "all");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("redis");
  });

  test("no match returns empty array", () => {
    expect(filterApps(all, "zzz-no-match", "all", "all")).toHaveLength(0);
  });

  test("large catalog performance: 2000 apps filters in <50ms", () => {
    const large: DockerApp[] = Array.from({ length: 2000 }, (_, i) => ({
      ...base,
      id: `app-${i}`,
      name: `App ${i}`,
      image: `img-${i % 50}:latest`,
      description: `desc ${i}`,
      group: i % 10 === 0 ? "grouped" : undefined,
    }));
    const t0 = performance.now();
    const r = filterApps(large, "app 1", "all", "all");
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe("collectGroups", () => {
  test("returns sorted unique groups, ungrouped for missing", () => {
    const groups = collectGroups([base, running, errorApp]);
    expect(groups).toContain("caches");
    expect(groups).toContain("ungrouped");
    expect(groups).toEqual([...groups].sort());
  });

  test("empty list returns empty", () => {
    expect(collectGroups([])).toEqual([]);
  });
});

describe("buildCardHTML", () => {
  test("stopped app shows Launch button", () => {
    const html = buildCardHTML(base);
    expect(html).toContain("data-action=\"launch\"");
    expect(html).not.toContain("data-action=\"stop\"");
  });

  test("running app shows Stop button", () => {
    const html = buildCardHTML(running);
    expect(html).toContain("data-action=\"stop\"");
    expect(html).not.toContain("data-action=\"launch\"");
  });

  test("starting app disables button", () => {
    const html = buildCardHTML({ ...base, status: "starting" });
    expect(html).toContain("disabled");
  });

  test("stopping app disables button", () => {
    const html = buildCardHTML({ ...base, status: "stopping" });
    expect(html).toContain("disabled");
  });

  test("includes app name", () => {
    expect(buildCardHTML(base)).toContain("Postgres");
  });

  test("includes Web UI action when openUrl is set", () => {
    const html = buildCardHTML({ ...base, openUrl: "http://localhost:8080" });
    expect(html).toContain('data-action="webui"');
  });

  test("includes status class", () => {
    expect(buildCardHTML(base)).toContain("status-dot--stopped");
    expect(buildCardHTML(running)).toContain("status-dot--running");
  });

  test("renders initials from single-word app name", () => {
    // "Postgres" → first two chars → "PO"
    expect(buildCardHTML(base)).toContain("PO");
  });

  test("renders initials from multi-word app name", () => {
    // "Home Assistant" → "HA"
    const html = buildCardHTML({ ...base, name: "Home Assistant" });
    expect(html).toContain("HA");
  });

  test("icon has gradient style attribute", () => {
    expect(buildCardHTML(base)).toContain("linear-gradient");
  });
});

describe("buildHubCardHTML", () => {
  const img: DockerHubImage = {
    name: "nginx",
    namespace: "library",
    fullName: "library/nginx",
    description: "Official Nginx image",
    starCount: 15000,
    pullCount: 1_000_000_000,
    isOfficial: true,
  };

  test("includes image display name", () => {
    expect(buildHubCardHTML(img, "nginx")).toContain("nginx");
  });

  test("includes star and pull counts", () => {
    const html = buildHubCardHTML(img, "nginx");
    expect(html).toContain("15,000");
    expect(html).toContain("1,000,000,000");
  });

  test("truncates long descriptions at 160 chars", () => {
    const long = "x".repeat(200);
    const html = buildHubCardHTML({ ...img, description: long }, "nginx");
    expect(html).toContain("x".repeat(160));
    expect(html).not.toContain("x".repeat(161));
  });

  test("falls back to 'No description' when empty", () => {
    const html = buildHubCardHTML({ ...img, description: "" }, "nginx");
    expect(html).toContain("No description");
  });

  test("includes install and details actions", () => {
    const html = buildHubCardHTML(img, "nginx");
    expect(html).toContain("data-action=\"install\"");
    expect(html).toContain("data-action=\"details\"");
  });
});
