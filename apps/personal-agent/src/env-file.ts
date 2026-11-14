/**
 * The owner's `.env` in the state directory: where the person pastes a provider key so it is kept on
 * this machine, readable only by them, and never in the configuration (which names only the variable).
 * Variables already set in the process environment win over the file.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENV_FILE = '.env';

const TEMPLATE = `# Keys for your personal agent's model provider, kept on this machine and readable only by you.
# Paste the key after "=" on the line whose name your configuration uses (--api-key-env), then save.
# A variable already set in the environment where the agent starts takes precedence over this file.
AI_GATEWAY_API_KEY=
OPENROUTER_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
`;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function envFilePath(stateDir: string): string {
  return join(stateDir, ENV_FILE);
}

/** `NAME=value` lines; blank values, comments and malformed lines are skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const name = line
      .slice(0, equals)
      .replace(/^export\s+/u, '')
      .trim();
    if (!NAME.test(name)) continue;
    let value = line.slice(equals + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    if (value !== '') values[name] = value;
  }
  return values;
}

/** A key file others can read is refused, with how to fix it, rather than used. */
function checkOwnerOnly(path: string): void {
  if (process.platform === 'win32') return;
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${path} is readable by other users; run \`chmod 600 ${path}\` and start again`,
    );
  }
}

/** The environment the agent runs with: the file's values under the process's own. */
export function withEnvFile(
  stateDir: string,
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const path = envFilePath(stateDir);
  if (!existsSync(path)) return { ...environment };
  checkOwnerOnly(path);
  const fromFile = parseEnvFile(readFileSync(path, 'utf8'));
  const merged: Record<string, string | undefined> = { ...fromFile };
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value !== '') merged[name] = value;
    else if (!(name in merged)) merged[name] = value;
  }
  return merged;
}

/** Create the owner-only file with a template the first time; an existing file is left as it is. */
export function ensureEnvFile(stateDir: string): string {
  const path = envFilePath(stateDir);
  if (!existsSync(path)) writeFileSync(path, TEMPLATE, { mode: 0o600, flag: 'wx' });
  checkOwnerOnly(path);
  return path;
}

/**
 * How to open the file for editing: the person's own editor first, else the system's text editor.
 * A terminal editor runs in this terminal; a desktop one opens a window.
 */
export function editorCommand(
  path: string,
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): { readonly command: string; readonly args: readonly string[]; readonly shell: boolean } {
  const chosen = environment['VISUAL'] || environment['EDITOR'];
  if (chosen !== undefined && chosen !== '') {
    // An editor setting may carry its own arguments ("code --wait"), so it runs through the shell.
    return { command: `${chosen} ${JSON.stringify(path)}`, args: [], shell: true };
  }
  if (platform === 'darwin') return { command: 'open', args: ['-t', path], shell: false };
  if (platform === 'win32') return { command: 'notepad', args: [path], shell: false };
  return { command: 'xdg-open', args: [path], shell: false };
}

export function openInEditor(
  path: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const { command, args, shell } = editorCommand(path, environment);
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: 'inherit',
      shell,
      env: environment as NodeJS.ProcessEnv,
    });
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
