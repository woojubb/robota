/**
 * ADOPT-003: Opt-in anonymous telemetry
 *
 * Default: disabled. Users must explicitly run `dag telemetry on` to enable.
 * Always disabled in CI (CI=true) or when ROBOTA_DAG_TELEMETRY=0.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const DAG_CONFIG_DIR = '.dag';
const CONFIG_FILENAME = 'config.json';
const TELEMETRY_ENDPOINT = 'https://telemetry.dag.robota.dev/v1/events';
const SESSION_ID_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ITelemetryEvent {
  readonly command: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly nodeTypes?: string[];
  readonly nodeCount?: number;
  readonly os: string;
  readonly nodeVersion: string;
  readonly cliVersion: string;
  readonly sessionId: string;
}

interface IGlobalDagConfig {
  telemetryEnabled?: boolean;
  sessionId?: string;
  sessionCreatedAt?: number;
  cliVersion?: string;
}

// ---------------------------------------------------------------------------
// Config file helpers
// ---------------------------------------------------------------------------

function globalConfigPath(): string {
  return join(homedir(), DAG_CONFIG_DIR, CONFIG_FILENAME);
}

export async function readTelemetryConfig(): Promise<IGlobalDagConfig> {
  const configPath = globalConfigPath();
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (_readErr) {
    // allow-fallback: missing config file is treated as empty config
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as IGlobalDagConfig;
    }
    return {};
  } catch (_parseErr) {
    // allow-fallback: malformed config returns empty object
    return {};
  }
}

async function writeTelemetryConfig(config: IGlobalDagConfig): Promise<void> {
  const configPath = globalConfigPath();
  const dir = join(homedir(), DAG_CONFIG_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Session ID (daily-rotated UUID)
// ---------------------------------------------------------------------------

async function getOrCreateSessionId(config: IGlobalDagConfig): Promise<string> {
  const now = Date.now();
  if (
    typeof config.sessionId === 'string' &&
    config.sessionId.length > 0 &&
    typeof config.sessionCreatedAt === 'number' &&
    now - config.sessionCreatedAt < SESSION_ID_TTL_MS
  ) {
    return config.sessionId;
  }
  // Generate and persist a new session ID
  const newId = randomUUID();
  const updated: IGlobalDagConfig = {
    ...config,
    sessionId: newId,
    sessionCreatedAt: now,
  };
  try {
    await writeTelemetryConfig(updated);
  } catch (_writeErr) {
    // allow-fallback: session ID persistence failure does not block telemetry
    // use the ephemeral ID anyway
  }
  return newId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether telemetry is enabled.
 * Returns false if CI=true or ROBOTA_DAG_TELEMETRY=0, regardless of config.
 */
export async function isTelemetryEnabled(): Promise<boolean> {
  if (process.env['CI'] === 'true') return false;
  if (process.env['ROBOTA_DAG_TELEMETRY'] === '0') return false;
  const config = await readTelemetryConfig();
  return config.telemetryEnabled === true;
}

/**
 * Enable telemetry and persist to ~/.dag/config.json.
 */
export async function enableTelemetry(): Promise<void> {
  const config = await readTelemetryConfig();
  await writeTelemetryConfig({ ...config, telemetryEnabled: true });
}

/**
 * Disable telemetry and persist to ~/.dag/config.json.
 */
export async function disableTelemetry(): Promise<void> {
  const config = await readTelemetryConfig();
  await writeTelemetryConfig({ ...config, telemetryEnabled: false });
}

/**
 * Record a telemetry event. No-ops silently if:
 *  - telemetry is disabled (opt-in not given)
 *  - CI=true or ROBOTA_DAG_TELEMETRY=0
 *  - the HTTP request fails for any reason
 */
export async function recordTelemetry(
  event: Omit<ITelemetryEvent, 'os' | 'nodeVersion' | 'cliVersion' | 'sessionId'>,
): Promise<void> {
  const enabled = await isTelemetryEnabled();
  if (!enabled) return;

  const config = await readTelemetryConfig();
  const sessionId = await getOrCreateSessionId(config);

  const fullEvent: ITelemetryEvent = {
    ...event,
    os: process.platform,
    nodeVersion: process.version,
    cliVersion: config.cliVersion ?? 'unknown',
    sessionId,
  };

  // Fire-and-forget; never surface errors to the user.
  void (async () => {
    try {
      await fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullEvent),
      });
    } catch (_fetchErr) {
      // allow-fallback: telemetry send failure is always silent
      // intentionally swallowed
    }
  })();
}
