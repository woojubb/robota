/**
 * Allow rules `auto` mode sets aside while it is on (issue #3082).
 *
 * The classifier is there to look at arbitrary execution; an allow rule that already approves
 * arbitrary execution would answer first and the classifier would never see it. So a rule that
 * approves running any program, any interpreter script, any package script or any subagent is not
 * applied in `auto` mode; a narrow rule (`Bash(npm test)`) still is. Leaving the mode restores them —
 * nothing is removed from the settings, the mode only reads fewer of them.
 */

import { parsePattern, toolNameMatches } from './permission-gate.js';

const SHELL_TOOLS = new Set(['Bash', 'Shell']);
const DELEGATING_TOOLS = new Set(['Agent', 'BackgroundProcess']);

/** Programs that run whatever code they are given. */
const INTERPRETERS = [
  'python',
  'python3',
  'node',
  'deno',
  'bun',
  'ruby',
  'perl',
  'php',
  'bash',
  'sh',
  'zsh',
  'pwsh',
  'powershell',
  'env',
  'xargs',
  'eval',
  'exec',
  'sudo',
];

/** Package-manager commands that run a package's own scripts or binaries. */
const PACKAGE_RUNNERS = [
  'npm run',
  'npm exec',
  'npx',
  'pnpm',
  'yarn',
  'bunx',
  'uv run',
  'cargo run',
  'make',
  'just',
];

/**
 * A command pattern approves arbitrary execution when it is a bare wildcard, when the program it
 * names runs whatever code it is given, or when it stops at a package runner (`npm run *`,
 * `pnpm *`) so any script matches. `Bash(pnpm test*)` names one script and stays.
 */
function approvesAnyCommand(argument: string): boolean {
  const trimmed = argument.trim();
  if (!trimmed.includes('*')) return false;
  const prefix = trimmed.slice(0, trimmed.indexOf('*')).trim();
  if (prefix === '') return true;
  const program = prefix.split(/\s+/)[0]!.replace(/[\d.]+$/, '');
  if (INTERPRETERS.includes(program)) return true;
  return PACKAGE_RUNNERS.some((runner) => runner === prefix || runner.startsWith(prefix));
}

/** Whether an allow rule approves arbitrary execution, and so is set aside in `auto` mode. */
export function isBroadExecutionAllowRule(pattern: string): boolean {
  const { toolName, argPattern } = parsePattern(pattern);
  const names = (tools: ReadonlySet<string>): boolean =>
    [...tools].some((tool) => toolNameMatches(toolName, tool));
  if (names(DELEGATING_TOOLS)) return true;
  if (!names(SHELL_TOOLS)) return false;
  // A name glob (`Ba*`) reaching a shell tool is as broad as naming it with no argument.
  if (toolName.includes('*')) return true;
  return argPattern === undefined || approvesAnyCommand(argPattern);
}

/** The allow rules `auto` mode applies: all but the broad execution ones. */
export function allowRulesForAutoMode(allow: readonly string[]): string[] {
  return allow.filter((pattern) => !isBroadExecutionAllowRule(pattern));
}
