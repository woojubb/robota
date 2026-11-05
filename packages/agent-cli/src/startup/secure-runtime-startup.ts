/**
 * The start of a secure supervised runtime: its spawner's pair, and the one rule that the pair and
 * the secure mode of its state root must agree on.
 *
 * A secure runtime has nothing to be admitted by but the owner link its spawner makes possible, so
 * the pair is what a secure supervised start carries and the only thing that does; the transport
 * token of a plain one cannot stand in for it. Each disagreement ends the start with a fixed message
 * before the process listens on anything.
 */
import { holdChildSpawns } from '@robota-sdk/agent-core/node';

import { optionArgv } from '../utils/option-argv.js';
import { createKeyringFileStore } from '../secure/keyring-store.js';
import { KeyHolder } from '../secure/key-holder.js';
import { productSecureMode, useProductKeyHolder } from '../product/session-sealing.js';
import { userPaths } from '../product/user-paths.js';
import {
  SUPERVISED_SPAWNER_PAIR_FLAG,
  answerHandedOverSpawnerPair,
} from '../session-inventory/supervised-spawner-pair.js';
import { SUPERVISED_TRANSPORT_TOKEN_FLAG } from '../session-inventory/supervised-transport-token.js';

import type { IRuntimeIdentity } from '@robota-sdk/agent-keyring';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

export { SUPERVISED_SPAWNER_PAIR_FLAG };

/** What a secure runtime is made of once its start is accepted. */
export interface ISecureServeRuntime {
  readonly identity: IRuntimeIdentity;
  readonly holder: KeyHolder;
}

function hasFlag(argv: readonly string[], flag: string): boolean {
  return optionArgv(argv).some((argument) => argument === flag || argument.startsWith(`${flag}=`));
}

export function spawnerPairRequested(argv: readonly string[]): boolean {
  return hasFlag(argv, SUPERVISED_SPAWNER_PAIR_FLAG);
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
export function answerSpawnerPairOrExit(argv: readonly string[]): IRuntimeIdentity | undefined {
  if (!spawnerPairRequested(argv)) return undefined;
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

/**
 * Checks that the pair and the secure mode of `runtime` agree, and for a secure runtime gives the
 * process the key holder its stores seal with. Ends the process with the fixed message when they do
 * not agree. Returns the secure runtime, or `undefined` for a plain one.
 */
export function startSecureRuntimeOrExit(
  runtime: ICliRuntimeContext,
  argv: readonly string[],
  identity: IRuntimeIdentity | undefined,
): ISecureServeRuntime | undefined {
  const refusal = secureStartupRefusal({
    secure: productSecureMode(runtime),
    pairFlag: spawnerPairRequested(argv),
    tokenFlag: hasFlag(argv, SUPERVISED_TRANSPORT_TOKEN_FLAG),
    supervised: hasFlag(argv, '--supervised-session-id'),
    serve: hasFlag(argv, '--serve'),
  });
  if (refusal !== undefined) {
    process.stderr.write(`${refusal}\n`);
    process.exit(1);
  }
  if (identity === undefined) return undefined;
  // The runtime holds no passphrase and has no terminal: an owner link hands it read keys.
  const holder = new KeyHolder({
    store: createKeyringFileStore({
      path: userPaths(runtime).keyring,
      root: runtime.layout.userRoot,
    }),
  });
  useProductKeyHolder(runtime, holder);
  return { identity, holder };
}
