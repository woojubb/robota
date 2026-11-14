/**
 * Where the personal agent keeps its state, and the provider profile it talks to.
 *
 * Everything the agent keeps lives under one owner-private state directory, so a local install, a
 * test run and a container differ only in which directory they hand in. The provider key is never
 * stored: a profile names the environment variable that holds it, and the key is read from the
 * environment when a provider is built.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface IProviderProfile {
  /** A provider definition type (or alias), such as `anthropic`, `openai` or `openai-compatible`. */
  readonly type: string;
  readonly model: string;
  readonly baseURL?: string;
  /** The environment variable that holds the API key; the key itself is never written. */
  readonly apiKeyEnv?: string;
}

export interface IPersonalAgentConfig {
  readonly version: 1;
  readonly provider?: IProviderProfile;
}

const CONFIG_FILE = 'config.json';
const EMPTY: IPersonalAgentConfig = { version: 1 };

/** The state directory: an explicit one, else `$PERSONAL_AGENT_STATE_DIR`, else `~/.robota/personal`. */
export function resolveStateDir(
  explicit: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (explicit !== undefined && explicit !== '') return explicit;
  const fromEnvironment = environment['PERSONAL_AGENT_STATE_DIR'];
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  return join(environment['HOME'] ?? homedir(), '.robota', 'personal');
}

/**
 * Create the state directory owner-only. An existing directory is used only when nobody else can
 * read it, or when it is empty (then it is tightened): permissions are never changed on a directory
 * that already holds someone's files, such as a home directory named by mistake.
 */
export function ensureStateDir(stateDir: string): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    return;
  }
  if (process.platform === 'win32') return;
  const mode = statSync(stateDir).mode & 0o777;
  if ((mode & 0o077) === 0) return;
  if (readdirSync(stateDir).length > 0) {
    throw new Error(`${stateDir} is readable by other users; choose an owner-only or empty state directory`);
  }
  chmodSync(stateDir, 0o700);
}

export function loadConfig(stateDir: string): IPersonalAgentConfig {
  const path = join(stateDir, CONFIG_FILE);
  if (!existsSync(path)) return EMPTY;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isConfig(parsed)) throw new Error(`${path} is not a personal agent configuration`);
  return parsed;
}

/** Write atomically and owner-only: a crash leaves the old file or the new one. */
export function saveConfig(stateDir: string, config: IPersonalAgentConfig): void {
  ensureStateDir(stateDir);
  const path = join(stateDir, CONFIG_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function isConfig(value: unknown): value is IPersonalAgentConfig {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1) return false;
  const provider = record['provider'];
  if (provider === undefined) return true;
  if (typeof provider !== 'object' || provider === null) return false;
  const profile = provider as Record<string, unknown>;
  return (
    typeof profile['type'] === 'string' &&
    typeof profile['model'] === 'string' &&
    (profile['baseURL'] === undefined || typeof profile['baseURL'] === 'string') &&
    (profile['apiKeyEnv'] === undefined || typeof profile['apiKeyEnv'] === 'string')
  );
}
