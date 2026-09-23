/**
 * FLOW-2006: the node wiring for `robota open <url>` — the only place this feature touches the host.
 *
 * It composes the deps from what the repository already owns: the node workspace-trust store and
 * identity resolver (`agent-framework`) and the argv-only git port (`agent-command`, BEHAVIOR-2437).
 * No new runner, no second parser over `workspace-trust.json`.
 */
import { createGitProcess } from '@robota-sdk/agent-command';
import {
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustStore,
} from '@robota-sdk/agent-framework';
import { statSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { createRemoteUrlReader, resolveLaunchInvocation, stripOpenInvocation } from './index.js';

import type { IResolveLaunchInvocationDeps, TLaunchTargetTrust } from './index.js';

function realDirectory(cwd: string): string | undefined {
  try {
    const real = realpathSync(cwd);
    return statSync(real).isDirectory() ? real : undefined;
  } catch {
    // allow-fallback: a path that cannot be stat'ed is not a usable target — the caller refuses it
    // by name, which is the same outcome as a path that exists but is a file.
    return undefined;
  }
}

function isMainWorktree(root: string): boolean {
  try {
    return statSync(join(root, '.git')).isDirectory();
  } catch {
    // allow-fallback: an unreadable `.git` means this clone cannot be PROVEN to be the main
    // worktree, and the grouping rule needs proof — treating it as a linked worktree is the
    // fail-closed answer, never a silently better one.
    return false;
  }
}

/** Build the host deps. `inspectTrust` answers `unknown` when the directory has no git identity. */
function createLaunchInvocationDeps(): IResolveLaunchInvocationDeps {
  const store = createNodeWorkspaceTrustStore();
  const resolver = createNodeWorkspaceIdentityResolver();
  const remoteUrl = createRemoteUrlReader(createGitProcess());
  return {
    listGrants: async () => (store.listGrants ? store.listGrants() : undefined),
    inspectTrust: async (cwd: string): Promise<TLaunchTargetTrust> => {
      let identity;
      try {
        identity = resolver.resolve(cwd);
      } catch {
        // No git workspace identity ⇒ no trust state to be `trusted`. A refusal, not a pass.
        return 'unknown';
      }
      return (await store.inspect(identity)).state;
    },
    realDirectory,
    readRemoteUrl: remoteUrl,
    isMainWorktree,
    isInteractive: () => process.stdout.isTTY === true && process.stdin.isTTY === true,
  };
}

/**
 * Apply a `robota open <url>` invocation, if this is one.
 *
 * Returns the prompt to prefill on success (possibly `undefined` when the link carried none), or
 * `'refused'` when the caller must stop. On success the process has already changed directory and
 * `process.argv` no longer carries the two tokens.
 */
export async function applyLaunchInvocation(): Promise<
  | { readonly kind: 'continue' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'launched'; readonly initialInput: string | undefined }
> {
  const outcome = await resolveLaunchInvocation(process.argv, createLaunchInvocationDeps());
  if (outcome.kind === 'not-an-open-invocation') return { kind: 'continue' };
  if (outcome.kind === 'refused') {
    process.stderr.write(`${outcome.message}\n`);
    process.exitCode = outcome.exitCode;
    return { kind: 'refused' };
  }
  process.chdir(outcome.cwd);
  stripOpenInvocation(process.argv);
  return { kind: 'launched', initialInput: outcome.initialInput };
}
