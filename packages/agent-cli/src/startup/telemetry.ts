import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface IRobotaSettings {
  telemetry?: boolean;
}

function settingsPath(): string {
  return join(homedir(), '.robota', 'settings.json');
}

function readSettings(): IRobotaSettings {
  const p = settingsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as IRobotaSettings;
  } catch {
    // allow-fallback: settings.json parse failure is non-fatal — return empty config
    return {};
  }
}

function writeSettings(settings: IRobotaSettings): void {
  const dir = join(homedir(), '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
}

export function isTelemetryEnabled(): boolean {
  return readSettings().telemetry === true;
}

export function setTelemetryEnabled(enabled: boolean): void {
  const settings = readSettings();
  writeSettings({ ...settings, telemetry: enabled });
}

export function sendTelemetryEvent(
  event: string,
  data?: Record<string, string | number | boolean>,
): void {
  if (!isTelemetryEnabled()) return;
  // No-op placeholder — in production, would send to telemetry endpoint.
  // PII is never collected: no file contents, paths, or usernames.
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };
  // Suppress send errors silently.
  void Promise.resolve().then(() => {
    void payload;
  });
}
