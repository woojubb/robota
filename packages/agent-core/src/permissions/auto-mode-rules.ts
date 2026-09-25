/**
 * Allow rules `auto` mode sets aside while it is on (issue #3082).
 *
 * The classifier is there to look at arbitrary execution; an allow rule that already approves
 * arbitrary execution would answer first and the classifier would never see it. So a rule that
 * approves running any program, any interpreter script, any package script or any subagent is not
 * applied in `auto` mode; a narrow rule (`Bash(npm test)`) still is. Leaving the mode restores them —
 * nothing is removed from the settings, the mode only reads fewer of them.
 */

import { getToolPermissionProfile, parsePattern, toolNameMatches } from './permission-gate.js';

/** Tools whose argument is a shell command line. */
const SHELL_TOOLS = ['Bash', 'Shell', 'BackgroundProcess'];
/** Tools that run whatever they are given, whatever their argument says. */
const DELEGATING_TOOLS = ['Agent'];
/** Execution tools a name glob could reach. */
const EXECUTION_TOOLS = [...SHELL_TOOLS, ...DELEGATING_TOOLS, 'ExecuteCommand', 'Computer'];

/** Programs that run whatever code or command they are given. */
const INTERPRETERS = [
  'python',
  'node',
  'deno',
  'bun',
  'ruby',
  'perl',
  'php',
  'bash',
  'sh',
  'zsh',
  'fish',
  'pwsh',
  'powershell',
  'cmd',
  'env',
  'xargs',
  'eval',
  'exec',
  'sudo',
  'timeout',
  'nohup',
  'nice',
  'time',
  'command',
  'setsid',
  'stdbuf',
  'watch',
  'ssh',
  'docker',
  'podman',
  'find',
];

/** Package-manager commands that run a package's own scripts or binaries. */
const PACKAGE_RUNNERS = [
  'npm run',
  'npm run-script',
  'npm exec',
  'npm x',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'bunx',
  'uv run',
  'uvx',
  'pipx run',
  'cargo run',
  'go run',
  'make',
  'just',
].map((runner) => runner.split(' '));

/** Words after a runner that still leave the script or package open. */
const RUNNER_PASSTHROUGH = new Set(['run', 'run-script', 'exec', 'dlx', 'x', '--']);

function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word).replace(/(\.exe)?$/i, '').replace(/[\d.]+$/, '');
}

/**
 * Whether the words before a command pattern's `*` leave the program open. `partial` means the `*`
 * continues the last word (`py*`), so that word matches anything it begins.
 */
function leavesProgramOpen(words: readonly string[], partial: boolean): boolean {
  if (words.length === 0) return true;
  const same = (candidate: string, word: string, last: boolean): boolean =>
    partial && last ? candidate.startsWith(word) : candidate === word;
  const first = programName(words[0]!);
  if (INTERPRETERS.some((name) => same(name, first, words.length === 1))) return true;
  for (const runner of PACKAGE_RUNNERS) {
    const covered = Math.min(runner.length, words.length);
    const matches = runner
      .slice(0, covered)
      .every((part, index) =>
        same(part, index === 0 ? first : words[index]!, index === words.length - 1),
      );
    if (!matches) continue;
    // `npm *`: the pattern stops inside the runner, so any of its scripts matches.
    if (words.length <= runner.length) return true;
    let rest = words.slice(runner.length);
    while (rest.length > 0 && (rest[0]!.startsWith('-') || RUNNER_PASSTHROUGH.has(rest[0]!))) {
      rest = rest.slice(1);
    }
    return rest.length === 0 || leavesProgramOpen(rest, partial);
  }
  return false;
}

/**
 * A command pattern approves arbitrary execution when it is a bare wildcard, when the program it
 * names runs whatever code it is given, or when it stops at a package runner (`npm run *`,
 * `pnpm exec *`) so any script matches. `Bash(pnpm test*)` names one script and stays.
 */
function approvesAnyCommand(argument: string): boolean {
  const trimmed = argument.trim();
  if (!trimmed.includes('*')) return false;
  const before = trimmed.slice(0, trimmed.indexOf('*'));
  const words = before
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const partial = before.length > 0 && !/\s$/.test(before);
  return leavesProgramOpen(words, partial);
}

/** Whether an allow rule approves arbitrary execution, and so is set aside in `auto` mode. */
export function isBroadExecutionAllowRule(pattern: string): boolean {
  const { toolName, argPattern } = parsePattern(pattern);
  const reaches = (tools: readonly string[]): boolean =>
    tools.some((tool) => toolNameMatches(toolName, tool));
  if (reaches(DELEGATING_TOOLS)) return true;
  // A name glob (`Ba*`) reaching an execution tool is as broad as naming it with no argument.
  if (toolName.includes('*')) return reaches(EXECUTION_TOOLS);
  const executes =
    EXECUTION_TOOLS.includes(toolName) ||
    getToolPermissionProfile(toolName).riskClass === 'execute';
  if (!executes) return false;
  if (argPattern === undefined || argPattern.trim() === '*') return true;
  return SHELL_TOOLS.includes(toolName) && approvesAnyCommand(argPattern);
}

/** The allow rules `auto` mode applies: all but the broad execution ones. */
export function allowRulesForAutoMode(allow: readonly string[]): string[] {
  return allow.filter((pattern) => !isBroadExecutionAllowRule(pattern));
}
