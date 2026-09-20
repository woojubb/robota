/**
 * FLOW-2006: the `robota open <url>` pre-parse step.
 *
 * It is not a subcommand route. Every route in `preparsed-command-routing.ts` TERMINATES the
 * process — `runPreparsedCliCommand` returning true means "handled, exit" — while `open` must
 * CONTINUE into an ordinary interactive session with a different working directory. So it runs at
 * the top of `startCli`, before `process.cwd()` is read and before the workspace is resolved, and
 * hands back either a refusal or the directory and prompt the normal startup path then uses.
 */
import { parseLaunchIntent, LAUNCH_INTENT_USAGE } from './launch-intent.js';
import { resolveLaunchTarget } from './resolve-launch-target.js';

import type { IResolveLaunchTargetDeps } from './resolve-launch-target.js';

export const OPEN_SUBCOMMAND = 'open';
/** `process.argv` position of the subcommand — after the executable and the script. */
const SUBCOMMAND_INDEX = 2;
/** Everything the subcommand itself takes starts one position later. */
const SUBCOMMAND_ARGS_INDEX = SUBCOMMAND_INDEX + 1;

export interface IResolveLaunchInvocationDeps extends IResolveLaunchTargetDeps {
  /** False when there is no composer to prefill — a prefilled session needs a terminal. */
  isInteractive: () => boolean;
}

export type TLaunchInvocation =
  | { readonly kind: 'not-an-open-invocation' }
  | { readonly kind: 'refused'; readonly message: string; readonly exitCode: number }
  | { readonly kind: 'launch'; readonly cwd: string; readonly initialInput: string | undefined };

function refused(message: string): TLaunchInvocation {
  return { kind: 'refused', message, exitCode: 1 };
}

/**
 * Decide what `argv` asks for. `argv` is the process argv: `[node, bin, 'open', '<url>', …flags]`.
 *
 * Exactly one POSITIONAL argument may follow `open` — the link. Microsoft documents that a handler's
 * command line can be extended by an attacker's quotes and backslashes, and Electron documents that
 * a second instance's argv can arrive with arguments appended, so a second positional is refused
 * rather than ignored. The user's own flags (`--name`, `--screen-reader`, …) are NOT positionals and
 * stay in the argv the ordinary parser reads: a link changes where the session starts and what is
 * typed into it, and nothing else about how the user invoked the CLI.
 */
export async function resolveLaunchInvocation(
  argv: readonly string[],
  deps: IResolveLaunchInvocationDeps,
): Promise<TLaunchInvocation> {
  if (argv[SUBCOMMAND_INDEX] !== OPEN_SUBCOMMAND) return { kind: 'not-an-open-invocation' };
  const rest = argv.slice(SUBCOMMAND_ARGS_INDEX);
  const link = rest[0];
  if (link === undefined) {
    return refused(`\`${OPEN_SUBCOMMAND}\` needs a link.\n${LAUNCH_INTENT_USAGE}`);
  }
  // Exactly ONE link. A second `robota:` token later in the argv is the smuggling shape the
  // platform documents — Windows' `ShellExecute` splitting on an attacker's quotes, Electron's
  // second-instance argv arriving with arguments appended — so it is refused rather than ignored.
  // Ordinary flags and their values are left alone: they are the user's invocation, not the link's.
  if (rest.slice(1).some((token) => token.toLowerCase().startsWith('robota:'))) {
    return refused(
      `\`${OPEN_SUBCOMMAND}\` takes exactly one link; a second one was given.\n${LAUNCH_INTENT_USAGE}`,
    );
  }
  // The link is judged BEFORE the terminal is: a malformed or untrusted link must be named as such
  // wherever it is run, or a scripted check would learn only that it lacks a TTY. Both steps are
  // read-only, so nothing happens on a run that is about to be refused anyway.
  const parsed = parseLaunchIntent(link);
  if (!parsed.ok) return refused(`Link refused: ${parsed.reason}`);
  const target = await resolveLaunchTarget(parsed.intent, deps);
  if (!target.ok) return refused(`Link refused: ${target.reason}`);
  if (!deps.isInteractive()) {
    return refused(
      'a prefilled session needs an interactive terminal; the prompt is never submitted on its own.',
    );
  }
  return { kind: 'launch', cwd: target.cwd, initialInput: parsed.intent.prompt };
}

/**
 * Remove `open <url>` from `process.argv` IN PLACE, once, before anything reads it.
 *
 * Three readers index the same array — `parseCliArgs()` defaults to `process.argv.slice(2)`,
 * `runPreparsedCliCommand` is handed `process.argv`, and the eval/session routes slice it
 * positionally — so a locally filtered copy would leave them disagreeing about one fact.
 */
export function stripOpenInvocation(argv: string[]): void {
  if (argv[SUBCOMMAND_INDEX] !== OPEN_SUBCOMMAND) return;
  argv.splice(SUBCOMMAND_INDEX, 2);
}
