const PORT_MAPPING_RE = /^\d{1,5}:\d{1,5}(\/(tcp|udp))?$/i;

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function generateAppId(name: string, timestamp = Date.now()): string {
  return (
    normalizeName(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") +
    "-" +
    timestamp
  );
}

export function parsePortMappings(input: string): string[] {
  return input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isValidPortMapping(mapping: string): boolean {
  if (!PORT_MAPPING_RE.test(mapping)) return false;
  const [host, containerWithProto] = mapping.split(":");
  const container = containerWithProto.split("/")[0];
  const hostPort = Number(host);
  const containerPort = Number(container);
  return (
    hostPort >= 1 &&
    hostPort <= 65535 &&
    containerPort >= 1 &&
    containerPort <= 65535
  );
}

export function validateOpenUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Open URL must use http or https.");
  }
  return parsed.toString();
}

export function validateLocalDomain(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    throw new Error("Local domain must be a single DNS label using letters, numbers, or hyphens.");
  }
  return trimmed;
}
