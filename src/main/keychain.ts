// src/main/keychain.ts
// Platform-specific keychain operations via CLI/shell.
// macOS  → security(1)
// Windows → PowerShell + DPAPI (ConvertTo-SecureString / ConvertFrom-SecureString)
// Linux  → secret-tool (libsecret)

const SERVICE = "container-cove";

function key(appId: string, envKey: string): string {
  return `${appId}::${envKey}`;
}

async function run(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    await p.exited;
    const stdout = (await new Response(p.stdout).text()).trim();
    return { ok: p.exitCode === 0, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

async function setMac(appId: string, envKey: string, value: string): Promise<void> {
  // Delete first (ignore errors) then add
  await run([
    "security", "delete-generic-password",
    "-s", SERVICE, "-a", key(appId, envKey),
  ]);
  const res = await run([
    "security", "add-generic-password",
    "-s", SERVICE, "-a", key(appId, envKey), "-w", value,
  ]);
  if (!res.ok) throw new Error("security add-generic-password failed");
}

async function getMac(appId: string, envKey: string): Promise<string | null> {
  const res = await run([
    "security", "find-generic-password",
    "-s", SERVICE, "-a", key(appId, envKey), "-w",
  ]);
  return res.ok ? res.stdout : null;
}

async function deleteMac(appId: string, envKey: string): Promise<void> {
  await run([
    "security", "delete-generic-password",
    "-s", SERVICE, "-a", key(appId, envKey),
  ]);
}

async function setWindows(appId: string, envKey: string, value: string): Promise<void> {
  // Use DPAPI via PowerShell to encrypt and store in a file under AppData
  const storePath = winStorePath(appId, envKey);
  const script = `
    $enc = ConvertTo-SecureString '${value.replace(/'/g, "''")}' -AsPlainText -Force |
      ConvertFrom-SecureString
    Set-Content -Path '${storePath}' -Value $enc
  `.trim();
  const res = await run(["powershell", "-NoProfile", "-Command", script]);
  if (!res.ok) throw new Error("DPAPI encrypt failed");
}

async function getWindows(appId: string, envKey: string): Promise<string | null> {
  const storePath = winStorePath(appId, envKey);
  const script = `
    if (Test-Path '${storePath}') {
      $enc = Get-Content -Path '${storePath}'
      $sec = ConvertTo-SecureString $enc
      $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($sec)
      try { [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr) }
      finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr) }
    }
  `.trim();
  const res = await run(["powershell", "-NoProfile", "-Command", script]);
  return res.ok && res.stdout ? res.stdout : null;
}

async function deleteWindows(appId: string, envKey: string): Promise<void> {
  const storePath = winStorePath(appId, envKey);
  await run(["powershell", "-NoProfile", "-Command",
    `if (Test-Path '${storePath}') { Remove-Item '${storePath}' }`]);
}

function winStorePath(appId: string, envKey: string): string {
  const appData = process.env.APPDATA ?? "";
  const safe = key(appId, envKey).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${appData}\\container-cove\\secrets\\${safe}.dpapi`;
}

async function setLinux(appId: string, envKey: string, value: string): Promise<void> {
  const res = await run([
    "secret-tool", "store",
    "--label", `${SERVICE}/${key(appId, envKey)}`,
    "service", SERVICE, "account", key(appId, envKey),
  ]);
  // secret-tool reads value from stdin; pipe is not supported here.
  // Use a temp approach via printf piped through shell.
  const p = Bun.spawn(
    ["sh", "-c", `printf '%s' '${value.replace(/'/g, "'\\''")}' | secret-tool store --label '${SERVICE}/${key(appId, envKey)}' service '${SERVICE}' account '${key(appId, envKey)}'`],
    { stdout: "pipe", stderr: "pipe" },
  );
  await p.exited;
  if (p.exitCode !== 0 && !res.ok) throw new Error("secret-tool store failed");
}

async function getLinux(appId: string, envKey: string): Promise<string | null> {
  const res = await run([
    "secret-tool", "lookup", "service", SERVICE, "account", key(appId, envKey),
  ]);
  return res.ok ? res.stdout : null;
}

async function deleteLinux(appId: string, envKey: string): Promise<void> {
  await run([
    "secret-tool", "clear", "service", SERVICE, "account", key(appId, envKey),
  ]);
}

export async function keychainSet(
  appId: string,
  envKey: string,
  value: string,
): Promise<void> {
  if (process.platform === "darwin") return setMac(appId, envKey, value);
  if (process.platform === "win32") return setWindows(appId, envKey, value);
  return setLinux(appId, envKey, value);
}

export async function keychainGet(
  appId: string,
  envKey: string,
): Promise<string | null> {
  if (process.platform === "darwin") return getMac(appId, envKey);
  if (process.platform === "win32") return getWindows(appId, envKey);
  return getLinux(appId, envKey);
}

export async function keychainDelete(
  appId: string,
  envKey: string,
): Promise<void> {
  if (process.platform === "darwin") return deleteMac(appId, envKey);
  if (process.platform === "win32") return deleteWindows(appId, envKey);
  return deleteLinux(appId, envKey);
}

/** Resolve keychain-backed env vars and merge into the app's env map. */
export async function resolveKeychainEnv(
  appId: string,
  env: Record<string, string>,
  keychainEnvKeys: string[] = [],
): Promise<Record<string, string>> {
  if (!keychainEnvKeys.length) return env;
  const resolved = { ...env };
  await Promise.all(
    keychainEnvKeys.map(async (k) => {
      const val = await keychainGet(appId, k);
      if (val !== null) resolved[k] = val;
    }),
  );
  return resolved;
}
