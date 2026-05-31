import { describe, expect, test } from "bun:test";
import type { AppMetricsPoint } from "../../shared/types";
import {
  buildSparkline,
  classifyLogLevel,
  filterLogLines,
  latestMetricsLabel,
  maskValue,
  rangeMs,
  scopeMetrics,
} from "./metrics";

function point(cpuPercent: number, memUsageMB: number, timestamp: number): AppMetricsPoint {
  return { id: "app", cpuPercent, memUsageMB, timestamp };
}

describe("maskValue", () => {
  test("returns value unmodified when masking disabled", () => {
    expect(maskValue("secret123", false)).toBe("secret123");
  });

  test("masks short values entirely", () => {
    expect(maskValue("abc", true)).toBe("****");
    expect(maskValue("1234", true)).toBe("****");
  });

  test("masks middle of longer values", () => {
    const result = maskValue("mysecret", true);
    expect(result).toBe("my****et");
  });

  test("empty string stays empty-ish", () => {
    expect(maskValue("", true)).toBe("****");
  });
});

describe("classifyLogLevel", () => {
  test("system lines", () => {
    expect(classifyLogLevel("[container-cove] started")).toBe("system");
    expect(classifyLogLevel("[pull] layer 1")).toBe("system");
  });

  test("error and warn heuristics", () => {
    expect(classifyLogLevel("ERROR: connection refused")).toBe("error");
    expect(classifyLogLevel("WARN: deprecated")).toBe("warn");
    expect(classifyLogLevel("listening on port 80")).toBe("info");
  });
});

describe("filterLogLines", () => {
  const lines = ["[container-cove] started", "ERROR: connection refused", "INFO: ready"];

  test("empty term returns all lines", () => {
    expect(filterLogLines(lines, "")).toEqual(lines);
  });

  test("case-insensitive match", () => {
    const r = filterLogLines(lines, "ERROR");
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("ERROR");
  });

  test("partial match works", () => {
    expect(filterLogLines(lines, "ready")).toHaveLength(1);
  });

  test("no match returns empty array", () => {
    expect(filterLogLines(lines, "zzz")).toHaveLength(0);
  });

  test("filters multiple matches", () => {
    expect(filterLogLines(lines, "e")).toHaveLength(3);
  });

  test("level filter error only", () => {
    expect(filterLogLines(lines, "", "error")).toHaveLength(1);
  });

  test("level and text combined", () => {
    expect(filterLogLines(lines, "connection", "error")).toHaveLength(1);
    expect(filterLogLines(lines, "ready", "error")).toHaveLength(0);
  });
});

describe("rangeMs", () => {
  test("1h is one hour in ms", () => {
    expect(rangeMs("1h")).toBe(3_600_000);
  });
  test("24h is 24 hours in ms", () => {
    expect(rangeMs("24h")).toBe(86_400_000);
  });
  test("7d is 7 days in ms", () => {
    expect(rangeMs("7d")).toBe(604_800_000);
  });
});

describe("scopeMetrics", () => {
  const now = 1_000_000;
  const pts = [
    point(10, 100, now - 2 * 3_600_000),   // 2h ago
    point(20, 200, now - 30 * 60_000),      // 30m ago
    point(30, 300, now - 5 * 60_000),       // 5m ago
  ];

  test("1h range excludes 2h-old point", () => {
    const r = scopeMetrics(pts, "1h", now);
    expect(r).toHaveLength(2);
    expect(r[0].cpuPercent).toBe(20);
  });

  test("24h range includes all", () => {
    expect(scopeMetrics(pts, "24h", now)).toHaveLength(3);
  });

  test("7d range includes all", () => {
    expect(scopeMetrics(pts, "7d", now)).toHaveLength(3);
  });

  test("empty array returns empty", () => {
    expect(scopeMetrics([], "1h", now)).toHaveLength(0);
  });
});

describe("buildSparkline", () => {
  test("empty array returns -", () => {
    expect(buildSparkline([])).toBe("-");
  });

  test("all-zero cpu gives lowest char", () => {
    const pts = [point(0, 0, 1), point(0, 0, 2), point(0, 0, 3)];
    const s = buildSparkline(pts);
    expect(s).toMatch(/^▁+$/);
  });

  test("100% cpu gives highest char", () => {
    const pts = [point(100, 0, 1)];
    const s = buildSparkline(pts);
    expect(s).toBe("█");
  });

  test("clamps last maxPoints points", () => {
    const pts = Array.from({ length: 50 }, (_, i) => point(0, 0, i));
    expect(buildSparkline(pts, 20)).toHaveLength(20);
  });
});

describe("latestMetricsLabel", () => {
  test("returns formatted label from scoped", () => {
    const scoped = [point(42.5, 128.25, 1)];
    const label = latestMetricsLabel(scoped, scoped);
    expect(label).toBe("CPU 42.5% / MEM 128.3 MB");
  });

  test("falls back to all when scoped is empty", () => {
    const all = [point(10, 50, 1)];
    const label = latestMetricsLabel([], all);
    expect(label).toBe("CPU 10.0% / MEM 50.0 MB");
  });

  test("returns null when both empty", () => {
    expect(latestMetricsLabel([], [])).toBeNull();
  });
});
