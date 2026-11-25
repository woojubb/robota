/**
 * The start of a secure supervised runtime: its spawner's pair, and the one rule that the pair and
 * the secure mode of its state root must agree on.
 *
 * A secure runtime has nothing to be admitted by but the owner link its spawner makes possible, so
 * the pair is what a secure supervised start carries and the only thing that does; the transport
 * token of a plain one cannot stand in for it. Each disagreement ends the start with a fixed message
 * before the process listens on anything.
 *
 * The caller gives the part of argv that can hold options, everything before the first `--`, so a
 * prompt after it that spells a flag stays text. What is product launch layout (which option names a
 * supervised session, which one serves), the secure decision and the keyring location are values the
 * caller supplies; registering the returned holder with the product's sealing is the caller's act.
 */
import { holdChildSpawns } from '@robota-sdk/agent-core/node';

import { KeyHolder } from './key-holder.js';
import { createKeyringFileStore } from './keyring-store.js';
import {
  SUPERVISED_SPAWNER_PAIR_FLAG,
  answerHandedOverSpawnerPair,
} from './supervised-spawner-pair.js';
import { SUPERVISED_TRANSPORT_TOKEN_FLAG } from './supervised-transport-token.js';

import type { IRuntimeIdentity } from '@robota-sdk/agent-keyring';

/** What a secure runtime is made of once its start is accepted. */
export interface ISecureServeRuntime {
  readonly identity: IRuntimeIdentity;
  readonly holder: KeyHolder;
}

function hasFlag(options: readonly string[], flag: string): boolean {
  return options.some((argument) => argument === flag || argument.startsWith(`${flag}=`));
}

export function spawnerPairRequested(options: readonly string[]): boolean {
  return hasFlag(options, SUPERVISED_SPAWNER_PAIR_FLAG);
}

export interface ISecureStartupFacts {
  /** Secure mode is on for this state root. */
  readonly secure: boolean;
  readonly pairFlag: boolean;
  readonly tokenFlag: boolean;
  /** The launch names a supervised session. */
  readonly supervised: boolean;
  readonly serve: boolean;
}

/** Why this start may not go on, or `undefined`; fixed text, so nothing a launcher passed is echoed. */
export function secureStartupRefusal(facts: ISecureStartupFacts): string | undefined {
  if (facts.pairFlag && facts.tokenFlag) {
    return `${SUPERVISED_SPAWNER_PAIR_FLAG} and ${SUPERVISED_TRANSPORT_TOKEN_FLAG} are exclusive: a secure runtime takes no WebSocket token.`;
  }
  if (facts.pairFlag && !facts.supervised) {
    return `${SUPERVISED_SPAWNER_PAIR_FLAG} is set only by a supervised launch.`;
  }
  if (facts.pairFlag && !facts.secure) {
    return `${SUPERVISED_SPAWNER_PAIR_FLAG} starts a secure runtime, and secure mode is not on for this state root.`;
  }
  if (facts.secure && (facts.supervised || facts.serve) && !facts.pairFlag) {
    return `A secure runtime starts only with the pair its spawner hands over (${SUPERVISED_SPAWNER_PAIR_FLAG}).`;
  }
  return undefined;
}

/**
 * The spawner pair answered, when this start carries one: first, before anything can start a
 * process. Ends the process with the reason when the exchange cannot be done, because a runtime told
 * to expect a spawner must not start without one.
 */
export function answerSpawnerPairOrExit(options: readonly string[]): IRuntimeIdentity | undefined {
  if (!spawnerPairRequested(options)) return undefined;
  const release = holdChildSpawns();
  try {
    return answerHandedOverSpawnerPair();
  } catch (error) {
    // allow-fallback: the message is fixed text with nothing that was exchanged; exit is the correct response
    process.stderr.write(`${error instanceof Error ? error.message : 'The spawner pair could not be answered.'}\n`);
    process.exit(1);
  } finally {
    release();
  }
}

/** What a start is checked against, and where its key holder reads the keyring. */
export interface ISecureRuntimeStart {
  /** Secure mode is on for this state root. */
  readonly secure: boolean;
  /** The part of argv before the first `--`. */
  readonly options: readonly string[];
  /** The launch names a supervised session. */
  readonly supervised: boolean;
  readonly serve: boolean;
  /** The keyring file and the state root it belongs to. */
  readonly keyring: { readonly path: string; readonly root: string };
}

/**
 * Checks that the pair and the secure mode of the start agree, and for a secure runtime gives the
 * process the key holder its stores seal with. Ends the process with the fixed message when they do
 * not agree. Returns the secure runtime, or `undefined` for a plain one.
 */
export function startSecureRuntimeOrExit(
  start: ISecureRuntimeStart,
  identity: IRuntimeIdentity | undefined,
): ISecureServeRuntime | undefined {
  const refusal = secureStartupRefusal({
    secure: start.secure,
    pairFlag: spawnerPairRequested(start.options),
    tokenFlag: hasFlag(start.options, SUPERVISED_TRANSPORT_TOKEN_FLAG),
    supervised: start.supervised,
    serve: start.serve,
  });
  if (refusal !== undefined) {
    process.stderr.write(`${refusal}\n`);
    process.exit(1);
  }
  if (identity === undefined) return undefined;
  // The runtime holds no passphrase and has no terminal: an owner link hands it read keys.
  const holder = new KeyHolder({
    store: createKeyringFileStore({ path: start.keyring.path, root: start.keyring.root }),
  });
  return { identity, holder };
}
