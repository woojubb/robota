/**
 * Hook runner — executes hooks for lifecycle events using the strategy pattern.
 *
 * Dispatches to registered IHookTypeExecutor implementations by definition type.
 * Default executors: CommandExecutor (shell), HttpExecutor (HTTP POST).
 *
 * Outcome semantics (SEC-015). Executors return a decoded `THookOutcome`, not an exit code:
 * - `allow` → its stdout is decoded for the response protocol below
 * - `deny`  → blocks, carrying the hook's reason
 * - `error` → the hook rendered NO verdict; recorded in `IRunHooksResult.errors`. Whether that
 *   BLOCKS is a per-event policy this runner deliberately does not decide: it reports, and the
 *   enforcement boundary reads `HOOK_ENFORCEMENT_POLICY` (SEC-016). `PreToolUse` fails closed on it
 *   today; every other event is advisory, because no other fire site consults `blocked` at all.
 *
 * stdout JSON semantics (Claude Code compatible):
 * - { continue: false } → block, regardless of exit code
 * - PreToolUse: { hookSpecificOutput: { permissionDecision, updatedInput } }
 * - UserPromptSubmit: { decision: "block" } → block; hookSpecificOutput.additionalContext → injected into stdout
 */

import { matchesGroup, getMatcherTarget } from './hook-matching.js';
import { PERMISSION_PRIORITY, parseHookJson } from './response-protocol.js';

import type {
  THookEvent,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
  IHookErrorOutcome,
} from './types.js';

/**
 * The default executors, loaded only when a caller supplies none (CORE-028).
 *
 * `CommandExecutor` imports `node:child_process`, and a STATIC import of it here put that specifier
 * into the browser build — which declares a `browser` export condition and cannot provide it. The
 * aliasing workaround made that worse rather than better: `child_process` resolved to an empty
 * object, so a build-time contract violation became a deferred `TypeError` in a user's page.
 *
 * A dynamic import keeps them out of the browser graph while leaving Node behaviour identical: this
 * function is reached only on the branch where the caller passed no executors, and `runHooks` was
 * already async, so nothing above changes shape. A browser caller that supplies its own executors
 * never loads them at all; one that does not gets the same failure it would get from
 * `node:child_process` itself, which is the honest outcome rather than a silent empty object.
 */
async function createDefaultExecutors(): Promise<IHookTypeExecutor[]> {
  const [{ CommandExecutor }, { HttpExecutor }] = await Promise.all([
    // eslint-disable-next-line no-restricted-syntax -- CORE-028: keeps `node:child_process` out of the browser build's static graph
    import('./executors/command-executor.js'),
    // eslint-disable-next-line no-restricted-syntax -- CORE-028: loaded on the same branch as its sibling above
    import('./executors/http-executor.js'),
  ]);
  return [new CommandExecutor(), new HttpExecutor()];
}

/** Result of running hooks for an event. */
export interface IRunHooksResult {
  blocked: boolean;
  reason?: string;
  /** Collected stdout from all hooks that returned `allow`. */
  stdout: string;
  /** Parsed updatedInput from PreToolUse hookSpecificOutput (PreToolUse only). */
  updatedInput?: Record<string, unknown>;
  /** Highest-priority permissionDecision from PreToolUse hooks (PreToolUse only). */
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
  /**
   * Hook types that were configured but had no registered executor, so nothing ran for them.
   *
   * Reported rather than logged. `AGENTS.md` makes "silence is not success" a rule-level invariant,
   * and a runner that skipped an unrecognised type quietly broke it: a config declaring
   * `{ type: 'guardrail', … }` with no guardrail registry supplied DISABLED the gate, and the author
   * saw no error at all. A `console.warn` would satisfy the letter of that comment while still being
   * invisible to a caller and untestable; a field on the result is something the caller can act on
   * and a test can assert.
   *
   * Absent when every configured hook had an executor — the ordinary case draws no attention.
   */
  unknownHookTypes?: readonly string[];
  /**
   * Hook executions that rendered no verdict (SEC-015). Absent when every hook decided.
   *
   * This is the field an enforcing consumer needs in order to fail closed, and its absence is why
   * it could not. A runner that folded `error` into `allow` would leave this `undefined` while
   * returning the same `blocked` value as correct code — which is exactly why the tests assert on
   * this rather than on `blocked` alone.
   */
  errors?: readonly IHookErrorOutcome[];
}

/**
 * Run all hooks for a given event.
 *
 * For PreToolUse: if any hook returns the `deny` outcome, or an `allow` whose stdout carries a JSON
 * deny directive, the tool call is blocked.
 * JSON stdout responses are parsed and applied per Claude Code spec.
 * Returns { blocked: true, reason } if blocked, otherwise { blocked: false, stdout }.
 *
 * @param config - Hooks configuration mapping events to hook groups
 * @param event - The lifecycle event being fired
 * @param input - Hook input data passed to executors
 * @param executors - Optional array of hook type executors (defaults to command + http)
 */
export async function runHooks(
  config: THooksConfig | undefined,
  event: THookEvent,
  input: IHookInput,
  executors?: IHookTypeExecutor[],
): Promise<IRunHooksResult> {
  if (!config) return { blocked: false, stdout: '' };

  const unknownHookTypes = new Set<string>();
  /** Hooks that rendered no verdict. Reported, never folded into a verdict — see `errors`. */
  const errors: IHookErrorOutcome[] = [];
  /**
   * The two "what did NOT decide" facts, carried on EVERY return path.
   *
   * They are built in one place because the previous shape repeated the `unknownHookTypes` spread at
   * each early return, and a second such field would have been four more chances to omit it on the
   * path that matters most — the one that returns early because something blocked.
   */
  const diagnostics = (): Pick<IRunHooksResult, 'unknownHookTypes' | 'errors'> => ({
    ...(unknownHookTypes.size > 0 && { unknownHookTypes: [...unknownHookTypes].sort() }),
    ...(errors.length > 0 && { errors: [...errors] }),
  });
  const groups = config[event];
  if (!groups || groups.length === 0) return { blocked: false, stdout: '' };

  const resolvedExecutors = executors ?? (await createDefaultExecutors());
  const executorMap = new Map<string, IHookTypeExecutor>();
  for (const executor of resolvedExecutors) {
    executorMap.set(executor.type, executor);
  }

  const stdoutParts: string[] = [];
  const matcherTarget = getMatcherTarget(input);

  // PreToolUse multi-hook priority tracking
  let highestPermissionPriority = -1;
  let highestPermissionDecision: 'allow' | 'deny' | 'ask' | 'defer' | undefined;
  let lastUpdatedInput: Record<string, unknown> | undefined;

  for (const group of groups) {
    if (!matchesGroup(group, matcherTarget)) continue;

    // Merge group-level env vars into hook input
    const groupInput = group.env ? { ...input, env: { ...input.env, ...group.env } } : input;

    for (const hook of group.hooks) {
      const executor = executorMap.get(hook.type);
      if (!executor) {
        // Nothing runs for this hook, and the caller is TOLD so — see `unknownHookTypes`. The
        // comment here used to promise a warning that was never emitted.
        unknownHookTypes.add(hook.type);
        continue;
      }

      const outcome = await executor.execute(hook, groupInput);

      // An explicit denial blocks, exactly as exit code 2 did.
      if (outcome.outcome === 'deny') {
        return {
          blocked: true,
          reason: outcome.reason || 'Blocked by hook',
          stdout: stdoutParts.join('\n'),
          ...diagnostics(),
        };
      }

      // No verdict. Recorded and skipped — the hook's output is NOT read, because a hook that
      // failed has not said anything, and treating its stdout as a response is how a malformed
      // body came to be a verdict in the first place. Whether this BLOCKS is the boundary's call,
      // read from `HOOK_ENFORCEMENT_POLICY` — the runner reports and does not enforce (SEC-016).
      if (outcome.outcome === 'error') {
        errors.push(outcome);
        continue;
      }

      const json = parseHookJson(outcome.stdout);

      if (json !== null) {
        // Common: continue: false → block
        if (json['continue'] === false) {
          const stopReason =
            typeof json['stopReason'] === 'string'
              ? json['stopReason']
              : 'Blocked by hook (continue: false)';
          return {
            blocked: true,
            reason: stopReason,
            stdout: stdoutParts.join('\n'),
            ...diagnostics(),
          };
        }

        // UserPromptSubmit: decision: "block" → block
        if (event === 'UserPromptSubmit' && json['decision'] === 'block') {
          const hookSpecific = json['hookSpecificOutput'];
          const additionalContext =
            hookSpecific !== null &&
            typeof hookSpecific === 'object' &&
            'additionalContext' in (hookSpecific as object)
              ? String((hookSpecific as Record<string, unknown>)['additionalContext'])
              : undefined;
          return {
            blocked: true,
            reason: 'Blocked by hook (decision: block)',
            stdout: additionalContext
              ? [...stdoutParts, additionalContext].join('\n')
              : stdoutParts.join('\n'),
            ...diagnostics(),
          };
        }

        // UserPromptSubmit: additionalContext without block → inject into stdout
        if (event === 'UserPromptSubmit') {
          const hookSpecific = json['hookSpecificOutput'];
          if (
            hookSpecific !== null &&
            typeof hookSpecific === 'object' &&
            'additionalContext' in (hookSpecific as object)
          ) {
            const ctx = String((hookSpecific as Record<string, unknown>)['additionalContext']);
            if (ctx) stdoutParts.push(ctx);
          }
        }

        // PreToolUse: parse permissionDecision and updatedInput
        if (event === 'PreToolUse') {
          const hookSpecific = json['hookSpecificOutput'];
          if (hookSpecific !== null && typeof hookSpecific === 'object') {
            const specific = hookSpecific as Record<string, unknown>;
            const decision = specific['permissionDecision'];
            if (typeof decision === 'string' && decision in PERMISSION_PRIORITY) {
              const priority = PERMISSION_PRIORITY[decision];
              if (priority > highestPermissionPriority) {
                highestPermissionPriority = priority;
                highestPermissionDecision = decision as 'allow' | 'deny' | 'ask' | 'defer';
              }
              // deny → immediate block
              if (decision === 'deny') {
                return {
                  blocked: true,
                  reason: 'Blocked by hook (permissionDecision: deny)',
                  stdout: stdoutParts.join('\n'),
                  permissionDecision: 'deny',
                  ...diagnostics(),
                };
              }
              // Track updatedInput from the highest-priority decision
              if (priority >= highestPermissionPriority && specific['updatedInput'] !== undefined) {
                lastUpdatedInput = specific['updatedInput'] as Record<string, unknown>;
              }
            }
          }
        }

        // systemMessage → inject into stdout for AI context
        if (typeof json['systemMessage'] === 'string' && json['systemMessage']) {
          stdoutParts.push(json['systemMessage']);
        }
      } else if (outcome.stdout.trim()) {
        // Raw text stdout (non-JSON)
        stdoutParts.push(outcome.stdout.trim());
      }
    }
  }

  const finalResult: IRunHooksResult = {
    blocked: false,
    stdout: stdoutParts.join('\n'),
  };

  if (highestPermissionDecision !== undefined) {
    finalResult.permissionDecision = highestPermissionDecision;
  }
  if (lastUpdatedInput !== undefined) {
    finalResult.updatedInput = lastUpdatedInput;
  }
  const { unknownHookTypes: unrecognised, errors: failed } = diagnostics();
  if (unrecognised !== undefined) finalResult.unknownHookTypes = unrecognised;
  if (failed !== undefined) finalResult.errors = failed;

  return finalResult;
}
