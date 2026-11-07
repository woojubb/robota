import {
  KeyHolderArtifactSealer,
  ProcessLocalArtifactSealer,
  WriteOnlyArtifactSealer,
} from '../secure/artifact-sealer.js';

import type { ICliRuntimeContext } from './runtime-context.js';
import type { KeyHolder } from '../secure/key-holder.js';
import type { IArtifactSealer, TArtifactSealing } from '@robota-sdk/agent-core';

/** Be told each time the key a process seals to is verified or changes; returns the way to stop. */
type TWatchSealingKey = (listener: () => void) => () => void;

/** What a process that seals seals with, and how it hears that the key it seals to changed. */
interface IProductSealing {
  readonly sealer: IArtifactSealer;
  readonly watchSealingKey: TWatchSealingKey;
  /** Whether the keys that open what it sealed are locked now; absent where it holds none. */
  readonly keysLocked?: () => boolean;
}

/**
 * How a subagent worker seals: as its parent decided, never from a keyring of its own. Plain until
 * the start payload's write grant is bound, then a write-only sealer for the grant's key, whose
 * listeners hear each newer grant.
 */
interface IWorkerSealing {
  sealer: WriteOnlyArtifactSealer | undefined;
  readonly listeners: Set<() => void>;
}

/** Explicit per-runtime overrides used by isolated tests. */
const secureModeOverrides = new WeakMap<ICliRuntimeContext, boolean>();

/** The one secure-mode decision used by store, worker, and command admission. */
export function productSecureMode(runtime: ICliRuntimeContext): boolean {
  return secureModeOverrides.get(runtime) ?? runtime.conversationMode === 'secure';
}

/** An interrupted mode change admits only the owner's `secure` recovery commands. */
export function assertProductConversationLaunch(runtime: ICliRuntimeContext, argv: readonly string[]): void {
  if (runtime.conversationMode !== 'preparing') return;
  if (argv[2] === 'secure') return;
  throw new Error(`Secure conversation preparation is incomplete; run \`${runtime.vocabulary.cliName} secure status\` and resume or cancel it before starting a session.`);
}

/** Test seam; product code never calls it. */
export function overrideProductSecureMode(runtime: ICliRuntimeContext, on: boolean): void {
  secureModeOverrides.set(runtime, on);
}

/** Preserve an invocation's secure-mode decision when its admitted environment is rebound. */
export function copyProductSecureMode(from: ICliRuntimeContext, to: ICliRuntimeContext): void {
  const mode = secureModeOverrides.get(from);
  if (mode !== undefined) secureModeOverrides.set(to, mode);
}

/** The runtimes of subagent workers in this process, each with what its parent handed it. */
const workerSealings = new WeakMap<ICliRuntimeContext, IWorkerSealing>();
/** The runtimes that hold keys of their own, each sealing with its holder's. */
const keyHolderSealings = new WeakMap<ICliRuntimeContext, IProductSealing>();
/** Each such runtime's holder, which its unlock gate (`key-custody.ts`) asks and locks. */
const keyHolders = new WeakMap<ICliRuntimeContext, KeyHolder>();
/** Each sealing runtime's one process-local sealer, made the first time it is asked for. */
const processLocalSealers = new WeakMap<ICliRuntimeContext, ProcessLocalArtifactSealer>();

/** The one source of this process's sealing, or `undefined` when it keeps everything plain. */
function productSealingOf(runtime: ICliRuntimeContext): IProductSealing | undefined {
  const worker = workerSealings.get(runtime);
  if (worker === undefined) return keyHolderSealings.get(runtime);
  if (worker.sealer === undefined) return undefined;
  return {
    sealer: worker.sealer,
    watchSealingKey: (listener) => {
      worker.listeners.add(listener);
      return () => {
        worker.listeners.delete(listener);
      };
    },
  };
}

/**
 * How every session store this process builds keeps its records. There is one answer for all of
 * them: the workspace composition's stores and the store a command builds to read saved sessions
 * must agree, or a store built without it would write plaintext beside sealed files once secure
 * conversation is on.
 *
 * A subagent worker's answer is its parent's: the sealing its write grant binds, plain while none is
 * bound, and never a keyring file read here. A process given a key holder seals with its keys; a
 * process is given one only where {@link productSecureMode} is on. A missing holder in secure mode
 * is an error, never a plaintext fallback.
 */
export function resolveProductSessionSealing(runtime: ICliRuntimeContext): TArtifactSealing {
  if (runtime.conversationMode === 'preparing') {
    throw new Error('Secure conversation preparation is incomplete; no conversation store may open.');
  }
  const sealing = productSealingOf(runtime);
  if (sealing === undefined && productSecureMode(runtime)) {
    throw new Error('Secure conversation sealing key holder is unavailable; no conversation store may open.');
  }
  return sealing === undefined ? 'plain' : { sealer: sealing.sealer };
}

/** A sealing for what only this process reads back: plain, or its one process-local sealer. */
export type TProductTransientSealing = 'plain' | { readonly sealer: ProcessLocalArtifactSealer };

/**
 * How the stores of what only this process reads back — its spilled tool results, its ephemeral
 * checkpoints — keep them: plain exactly when {@link resolveProductSessionSealing} is, so the two
 * never disagree; otherwise sealed with the runtime's one process-local key, made the first time it
 * is needed and shared by every store the runtime builds (serve and ACP build a session's stores again
 * in the same process, and a key per store would leave what an earlier one wrote unreadable). Not the
 * keyring's: these are read back mid-turn, which a locked keyring could not do, and nothing after this
 * process needs them. The type admits no other sealer, so the keyring's cannot stand in for it.
 */
export function resolveProductTransientSealing(
  runtime: ICliRuntimeContext,
): TProductTransientSealing {
  if (resolveProductSessionSealing(runtime) === 'plain') return 'plain';
  let sealer = processLocalSealers.get(runtime);
  if (sealer === undefined) {
    sealer = new ProcessLocalArtifactSealer();
    processLocalSealers.set(runtime, sealer);
  }
  return { sealer };
}

/**
 * What tells a store a person reads conversations from (`/rewind`) that the keyring holder is locked
 * now, so those reads are refused while it is, whichever key the store seals with: present exactly
 * for a process that holds keys of its own. What the running turn reads back for itself (a spilled
 * tool result) is never gated.
 */
export function resolveProductKeysLocked(runtime: ICliRuntimeContext): (() => boolean) | undefined {
  return productSealingOf(runtime)?.keysLocked;
}

/**
 * How the product's subagent runner keeps its children's logs, from the same decision as every
 * store: plain, or a sealing together with the way to hear that the key it seals to was verified or
 * changed, so running children follow it. The type admits no sealing without that watch.
 */
export type TProductRunnerSealing =
  | { readonly logSealing: 'plain' }
  | {
      readonly logSealing: { readonly sealer: IArtifactSealer };
      readonly watchSealingKey: TWatchSealingKey;
    };

/** The runner options for `runtime`'s sealing; see {@link TProductRunnerSealing}. */
export function resolveProductRunnerSealing(runtime: ICliRuntimeContext): TProductRunnerSealing {
  if (runtime.conversationMode === 'preparing') {
    throw new Error('Secure conversation preparation is incomplete; no subagent log may open.');
  }
  const sealing = productSealingOf(runtime);
  if (sealing === undefined && productSecureMode(runtime)) {
    throw new Error('Secure conversation sealing key holder is unavailable; no subagent log may open.');
  }
  return sealing === undefined
    ? { logSealing: 'plain' }
    : { logSealing: { sealer: sealing.sealer }, watchSealingKey: sealing.watchSealingKey };
}

/**
 * Makes `holder` the one whose keys every store and subagent log of `runtime` seals with: one sealer
 * over it, and its sealing-key changes as the watch the runner follows. Refused for a runtime
 * {@link productSecureMode} is off for, so stores never seal before secure mode is on.
 */
export function useProductKeyHolder(runtime: ICliRuntimeContext, holder: KeyHolder): void {
  if (!productSecureMode(runtime)) {
    throw new Error('Secure mode is off for this state root, so no key holder seals its stores.');
  }
  keyHolderSealings.set(runtime, {
    sealer: new KeyHolderArtifactSealer(holder),
    watchSealingKey: (listener) => holder.onSealingKeyChange(listener),
    keysLocked: () => !holder.isUnlocked,
  });
  keyHolders.set(runtime, holder);
}

/**
 * The holder {@link useProductKeyHolder} gave `runtime`, or `undefined`: the one an unlock in this
 * process opens, so the gate never unlocks keys the stores do not seal with.
 */
export function productKeyHolder(runtime: ICliRuntimeContext): KeyHolder | undefined {
  return productSecureMode(runtime) ? keyHolders.get(runtime) : undefined;
}

/**
 * Makes `runtime` a subagent worker's for the sealing decision, and returns how the worker binds the
 * write grant its parent sends: the start payload's before anything is built, then each newer one
 * (the parent's verified key changed), which the same sealer seals to from then on. Each bind returns
 * the sealing every store and the subagent log of this worker then use.
 */
export function createProductWorkerSealing(runtime: ICliRuntimeContext): {
  readonly bindWriteGrant: (grant: string) => TArtifactSealing;
} {
  const worker = workerSealings.get(runtime) ?? { sealer: undefined, listeners: new Set() };
  workerSealings.set(runtime, worker);
  return {
    bindWriteGrant: (grant) => {
      if (worker.sealer === undefined) {
        worker.sealer = new WriteOnlyArtifactSealer(grant);
        return { sealer: worker.sealer };
      }
      worker.sealer.replaceGrant(grant);
      for (const listener of [...worker.listeners]) listener();
      return { sealer: worker.sealer };
    },
  };
}
