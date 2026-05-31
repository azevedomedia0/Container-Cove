// src/renderer/app-window/metrics.ts — pure functions extracted for testability
import type { AppMetricsPoint } from "../../shared/types";

export function maskValue(v: string, maskEnabled: boolean): string {
  if (!maskEnabled) return v;
  if (v.length <= 4) return "****";
  return v.slice(0, 2) + "****" + v.slice(-2);
}

export type LogLevel = "all" | "error" | "warn" | "info" | "system";

export function classifyLogLevel(line: string): Exclude<LogLevel, "all"> {
  if (line.startsWith("[container-cove]") || line.startsWith("[pull]"))
    return "system";
  const upper = line.toUpperCase();
  if (/\b(FATAL|ERROR|ERR)\b/.test(upper) || upper.includes(" E ")) return "error";
  if (/\bWARN(ING)?\b/.test(upper)) return "warn";
  return "info";
}

export function filterLogLines(
  lines: string[],
  term: string,
  level: LogLevel = "all",
): string[] {
  let out = lines;
  if (level !== "all") {
    out = out.filter((l) => classifyLogLevel(l) === level);
  }
  if (!term) return out;
  const lower = term.toLowerCase();
  return out.filter((l) => l.toLowerCase().includes(lower));
}

export type MetricsRange = "1h" | "24h" | "7d";

export function rangeMs(range: MetricsRange): number {
  if (range === "1h") return 60 * 60 * 1000;
  if (range === "24h") return 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

export function scopeMetrics(
  points: AppMetricsPoint[],
  range: MetricsRange,
  now = Date.now(),
): AppMetricsPoint[] {
  const cutoff = now - rangeMs(range);
  return points.filter((p) => p.timestamp >= cutoff);
}

const SPARKLINE_CHARS = "▁▂▃▄▅▆▇█";

export function buildSparkline(points: AppMetricsPoint[], maxPoints = 20): string {
  const recent = points.slice(-maxPoints);
  if (!recent.length) return "-";
  return recent
    .map((m) => SPARKLINE_CHARS[Math.min(7, Math.round(m.cpuPercent / 12.5))] ?? "▁")
    .join("");
}

export function latestMetricsLabel(
  scoped: AppMetricsPoint[],
  all: AppMetricsPoint[],
): string | null {
  const latest = scoped.at(-1) ?? all.at(-1);
  if (!latest) return null;
  return `CPU ${latest.cpuPercent.toFixed(1)}% / MEM ${latest.memUsageMB.toFixed(1)} MB`;
}
