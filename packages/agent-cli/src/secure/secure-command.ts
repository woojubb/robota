/**
 * `the product secure setup | status | enable | disable | verify | change-passphrase`: manage the
 * conversation choice and the keyring that secure conversations are sealed to.
 *
 * A passphrase or recovery key is typed at an interactive terminal and comes from nowhere else: not
 * an argument, not the environment, not a pipe, not a file. That is why there is no environment or
 * argument handling for a secret in this module at all, why every command that asks for one refuses
 * unless stdin is a terminal, and why the program a model starts through its shell tool (a new
 * session with no controlling terminal and `/dev/null` for input) is turned away before any prompt.
 * What this can check is a terminal, not a person: a program that allocates a pseudo-terminal of its
 * own and types into it is outside this guard.
 *
 * There is no `unlock` here: unlocked keys live in the process that uses them. `lock` asks each
 * reachable secure runtime to discard its keys and needs no secret.
 *
 * Creating a keyring is all `setup` does; only a confirmed `enable` turns secure mode on.
 * `migrate` and `compact` (`secure-migrate.ts`) run only once secure mode is on, and until then
 * refuse with a fixed message; they are left out of the usage while they cannot run.
 */
import {
  KeyringError,
  changePassphrase,
  createKeyring,
  fingerprint,
  type IKeyring,
} from '@robota-sdk/agent-keyring';

import { SecretInputCancelled } from '../devices/secret-terminal.js';
import { writeProductMigrationMarker } from '../product/process-presence.js';
import { productSecureMode } from '../product/session-sealing.js';
import { userPaths } from '../product/user-paths.js';
import { writeProductConversationMode } from './conversation-mode-state.js';
import { createInterface } from 'node:readline/promises';
import { listSupervisedSessions, lockSupervisedSession, resolveSupervisedDirectory } from '../session-inventory/supervised-session-control.js';
import { KeyHolder, SealingKeyMismatchError } from '@robota-sdk/agent-local-host';
import { KeyringStoreError, createKeyringFileStore, type IKeyringStore } from '@robota-sdk/agent-local-host';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_SEALING_KEY_MISMATCH_INCOMPLETE,
  EXIT_SEALING_KEY_REPAIRED,
  describeMismatchFailure,
  fingerprintOf,
  mismatchOf,
  missingKeyring,
  warnSealingKeyMismatch,
  type ISealingKeyMismatch,
} from './sealing-key-warning.js';
import {
  presentRecoveryKey,
  readNewPassphrase,
  unlockAtTerminal,
  type TCredentialKind,
} from './secure-conversations.js';
import {
  runSecureCompact,
  runSecureEnable,
  runSecureMigrate,
  type ISecureMigrateOptions,
} from './secure-migrate.js';
import { openSecureTerminal } from './secure-terminal.js';

import type { ISecretTerminalSession } from '../devices/secret-terminal.js';

export interface ISecureCommandOptions extends ISecureMigrateOptions {
  /** Whether stdin is a terminal; defaults to this process's. */
  readonly stdinIsTTY?: boolean;
  /** Whether stdout is a terminal; defaults to this process's. */
  readonly stdoutIsTTY?: boolean;
  /** Opens the secret terminal, or answers `undefined` when this process has none; defaults to the platform's. */
  readonly openTerminal?: () => ISecretTerminalSession | undefined;
  /** The keyring file; defaults to the user's `secure/keyring.json`. */
  readonly store?: IKeyringStore;
}

type TSecureAction =
  | { readonly action: 'setup' }
  | { readonly action: 'status' }
  | { readonly action: 'enable' }
  | { readonly action: 'disable' }
  | { readonly action: 'lock' }
  | { readonly action: 'verify'; readonly credential: TCredentialKind }
  | { readonly action: 'change-passphrase'; readonly credential: TCredentialKind }
  | { readonly action: 'migrate'; readonly dryRun: boolean }
  | { readonly action: 'compact' };

export const SECURE_USAGE = (cliName: string): string =>
  `Usage: ${cliName} secure setup\n` +
  `       ${cliName} secure status\n` +
  `       ${cliName} secure enable\n` +
  `       ${cliName} secure disable\n` +
  `       ${cliName} secure lock\n` +
  `       ${cliName} secure verify [--recovery]\n` +
  `       ${cliName} secure change-passphrase [--recovery]\n` +
  'A passphrase or recovery key is typed at the terminal when asked; it is never an argument.\n';

/** The action the arguments name, or `undefined` for anything else; what was typed is never echoed. */
function parseSecureArgs(args: readonly string[]): TSecureAction | undefined {
  const [action, ...flags] = args;
  if (action === 'setup' || action === 'status' || action === 'lock' || action === 'enable' || action === 'disable') return flags.length === 0 ? { action } : undefined;
  if (action === 'verify' || action === 'change-passphrase') {
    if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--recovery')) return undefined;
    return { action, credential: flags.length === 1 ? 'recoveryKey' : 'passphrase' };
  }
  if (action === 'migrate') {
    if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--dry-run')) return undefined;
    return { action, dryRun: flags.length === 1 };
  }
  if (action === 'compact') return flags.length === 0 ? { action } : undefined;
  return undefined;
}

/** The fixed refusal of `migrate` and `compact` while secure mode is off. */
export const SECURE_MODE_OFF = (cliName: string, action: 'migrate' | 'compact'): string =>
  `${cliName} secure ${action} runs only in secure mode, which is not on for this state root. Nothing was changed.\n`;

type TSecureActionName = TSecureAction['action'];

const CANCELLED: Readonly<Record<TSecureActionName, string>> = {
  setup: 'Cancelled. No keyring was created.',
  status: 'Cancelled.',
  enable: 'Cancelled. Secure conversations remain off.',
  disable: 'Cancelled. Secure conversations remain on.',
  lock: 'Cancelled.',
  verify: 'Cancelled.',
  'change-passphrase': 'Cancelled. The passphrase was not changed.',
  migrate: 'Cancelled. Nothing was changed.',
  compact: 'Cancelled. Nothing was changed.',
};

/** What a store refusal means for the command that met it; `undefined` where the store's own text says it. */
function describeStoreFailure(
  error: KeyringStoreError,
  action: TSecureActionName,
  cliName: string,
): string | undefined {
  const because = error.reason === undefined ? '' : ` [${error.reason}]`;
  const verify = `\`${cliName} secure verify\``;
  switch (error.code) {
    case 'exists':
      return `A keyring appeared at ${error.path} meanwhile; this one was not saved.`;
    case 'changed':
      return 'The keyring changed while you were working; nothing was saved. Run the command again.';
    case 'busy':
      return 'Another process is changing the keyring right now; nothing was saved. Try again in a moment.';
    case 'committed-unconfirmed':
      return action === 'change-passphrase'
        ? `The new keyring was written, but confirming that it reached the disk failed${because}. ` +
            `The new passphrase is most likely the one that works now: run ${verify} with it.`
        : `The keyring was written, but confirming that it reached the disk failed${because}. ` +
            `It is most likely in place: run ${verify} with the passphrase you chose.`;
    case 'verify-failed':
      return `The keyring was written, but reading it back gave a different keyring: something else changed it. Run ${verify} to see which passphrase opens it.`;
    default:
      return undefined;
  }
}

/** The message for a failure, built from fixed text and the error's class: never from anything typed. */
function describeFailure(error: unknown, action: TSecureActionName, cliName: string): string {
  if (error instanceof SecretInputCancelled) return CANCELLED[action];
  if (error instanceof KeyringStoreError) {
    return describeStoreFailure(error, action, cliName) ?? error.message;
  }
  if (error instanceof SealingKeyMismatchError) return describeMismatchFailure(error, cliName);
  if (error instanceof KeyringError) return error.message;
  return `The command failed unexpectedly (${error instanceof Error ? error.name : 'unknown'}).`;
}

function modeText(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

function describeSlots(keyring: IKeyring): string {
  return keyring.slots
    .map((slot) =>
      slot.type === 'passphrase'
        ? `passphrase (scrypt N=${slot.kdf.N}, r=${slot.kdf.r}, p=${slot.kdf.p})`
        : 'recovery key',
    )
    .join(', ');
}

function runStatus(store: IKeyringStore, options: ISecureCommandOptions): number {
  const cliName = options.productRuntime.vocabulary.cliName;
  const modeLine = `Conversation mode: ${options.productRuntime.conversationMode}\n`;
  const before = store.inspect();
  if (!before.exists) {
    options.stdout(
      `${modeLine}No keyring exists at ${store.path}.\nRun \`${cliName} secure setup\` to create one.\n`,
    );
    return EXIT_OK;
  }
  const loaded = store.load();
  if (loaded.status === 'missing') {
    options.stdout(`${modeLine}No keyring exists at ${store.path}.\n`);
    return EXIT_OK;
  }
  const after = store.inspect();
  const lines = [modeLine.trimEnd(), `Keyring: ${store.path}`];
  if (after.mode !== undefined) {
    const tightened =
      before.mode !== undefined && before.mode !== after.mode && (after.mode & 0o077) === 0
        ? ` (was ${modeText(before.mode)}, readable by other accounts; tightened now)`
        : '';
    lines.push(`File: mode ${modeText(after.mode)}${tightened}`);
    if ((after.mode & 0o077) !== 0) {
      lines.push('WARNING: other accounts can read this file and it could not be tightened.');
    }
  }
  lines.push(
    `Slots: ${describeSlots(loaded.keyring)}`,
    `Sealing public key fingerprint: ${fingerprintOf(loaded.keyring)}`,
    `Nothing here proves the stored key is the one your passphrase derives; \`${cliName} secure verify\` does, by unlocking.`,
  );
  options.stdout(`${lines.join('\n')}\n`);
  return EXIT_OK;
}

async function runDisable(options: ISecureCommandOptions): Promise<number> {
  const runtime = options.productRuntime;
  if (runtime.conversationMode === 'preparing') {
    options.stderr(`Secure conversation preparation is incomplete; resume \`${runtime.vocabulary.cliName} secure enable\` before turning it off.\n`);
    return EXIT_FAILED;
  }
  if (runtime.conversationMode === 'plain') {
    options.stdout('Secure conversations are already off. New conversations are saved in plaintext.\n');
    return EXIT_OK;
  }
  if (!(options.stdinIsTTY ?? process.stdin.isTTY === true)) {
    options.stderr(`\`${runtime.vocabulary.cliName} secure disable\` needs an interactive terminal.\n`);
    return EXIT_FAILED;
  }
  const answer = options.confirm === undefined
    ? await (async (): Promise<string> => {
        const prompt = createInterface({ input: process.stdin, output: process.stderr });
        try {
          return await prompt.question('Turn off secure conversations? New conversations will be saved in plaintext. [y/N] ');
        } finally {
          prompt.close();
        }
      })()
    : await options.confirm('Turn off secure conversations? New conversations will be saved in plaintext. [y/N] ');
  if (!/^y(es)?$/iu.test(answer.trim())) {
    options.stderr('Cancelled. Secure conversations remain on.\n');
    return EXIT_FAILED;
  }
  const marker = writeProductMigrationMarker(runtime, { mode: 'secure migrate' });
  try {
    const others = marker.others();
    if (others.length > 0) {
      options.stderr(`Could not turn secure conversations off while ${others.length} product process(es) or migration(s) remain active or uncertain. Close them and try again.\n`);
      return EXIT_FAILED;
    }
    writeProductConversationMode(runtime.layout.userRoot, 'secure', 'plain');
    options.stdout('Secure conversations are off. New conversations will be saved in plaintext. The sealed archive and keyring remain in place.\n');
    return EXIT_OK;
  } finally {
    marker.release();
  }
}

async function runSetup(
  store: IKeyringStore,
  terminalSession: ISecretTerminalSession,
  options: ISecureCommandOptions,
): Promise<number> {
  const cliName = options.productRuntime.vocabulary.cliName;
  if (store.load().status === 'present') {
    options.stderr(
      `A keyring already exists at ${store.path}; setup never replaces one.\n` +
        `To change its passphrase, run \`${cliName} secure change-passphrase\`.\n`,
    );
    return EXIT_FAILED;
  }
  const created = await terminalSession.run(async (terminal) => {
    const passphrase = await readNewPassphrase(terminal);
    if (passphrase === undefined) return undefined;
    const { keyring, recoveryKey, unlocked } = await createKeyring({ passphrase });
    unlocked.lock();
    // The keyring is saved only after the key was shown and typed back: a keyring whose recovery key
    // the person never had in hand is worse than none.
    return (await presentRecoveryKey(terminal, keyring, recoveryKey)) ? keyring : undefined;
  });
  if (created === undefined) {
    options.stderr(
      'No keyring was created: the passphrase or the recovery key was not confirmed.\n',
    );
    return EXIT_FAILED;
  }
  // Another setup may have finished while this one waited on the person: the create refuses
  // (`exists`) rather than write over it.
  store.create(created);
  options.stdout(
    [
      `Keyring created: ${store.path}`,
      `Sealing public key fingerprint: ${fingerprintOf(created)}`,
      `Compare that with \`${cliName} secure status\` later; it should never change.`,
      'The recovery key was shown once on your terminal and is not stored anywhere.',
      'This file is the only copy of your keys: the recovery key opens it but cannot replace it,',
      'so if the file is lost, everything sealed to it is lost.',
      productSecureMode(options.productRuntime)
        ? 'This only created the keyring.'
        : 'This only created the keyring. Secure mode is not turned on for sessions yet.',
    ].join('\n') + '\n',
  );
  return EXIT_OK;
}

async function runVerify(
  store: IKeyringStore,
  terminalSession: ISecretTerminalSession,
  credential: TCredentialKind,
  options: ISecureCommandOptions,
): Promise<number> {
  const before = store.load();
  if (before.status === 'missing') return missingKeyring(store, options);
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  let opened: Awaited<ReturnType<typeof unlockAtTerminal>>;
  try {
    opened = await terminalSession.run((terminal) =>
      unlockAtTerminal(terminal, holder, credential),
    );
  } catch (error) {
    if (!(error instanceof SealingKeyMismatchError)) throw error;
    options.stderr(
      `${describeMismatchFailure(error, options.productRuntime.vocabulary.cliName)}\n`,
    );
    warnSealingKeyMismatch(store, options, mismatchOf(error));
    return EXIT_SEALING_KEY_MISMATCH_INCOMPLETE;
  } finally {
    holder.lock('explicit');
  }
  if (opened === undefined) {
    options.stderr('The keyring was not unlocked.\n');
    return EXIT_FAILED;
  }
  const derived = fingerprint(holder.sealingPublicKey());
  if (opened.sealingKey === 'repaired') {
    const repaired = warnSealingKeyMismatch(store, options, {
      stored: fingerprintOf(before.keyring),
      derived,
    });
    return repaired ? EXIT_SEALING_KEY_REPAIRED : EXIT_SEALING_KEY_MISMATCH_INCOMPLETE;
  }
  options.stdout(
    `Verified: the stored sealing public key ${derived} is the one your keyring derives.\n`,
  );
  return EXIT_OK;
}

async function runChangePassphrase(
  store: IKeyringStore,
  terminalSession: ISecretTerminalSession,
  credential: TCredentialKind,
  options: ISecureCommandOptions,
): Promise<number> {
  const stored = store.load();
  if (stored.status === 'missing') return missingKeyring(store, options);
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  // A mismatch found on the way is owed its warning even when the person then cancels or the save
  // fails, and decides the exit status with how the command ended.
  let mismatch: ISealingKeyMismatch | undefined;
  let code: number;
  try {
    code = await changeWith(
      store,
      stored.keyring,
      terminalSession,
      holder,
      credential,
      options,
      (found) => {
        mismatch ??= found;
      },
    );
  } catch (error) {
    if (error instanceof SealingKeyMismatchError) mismatch ??= mismatchOf(error);
    options.stderr(
      `${describeFailure(error, 'change-passphrase', options.productRuntime.vocabulary.cliName)}\n`,
    );
    code = EXIT_FAILED;
  } finally {
    holder.lock('explicit');
  }
  if (mismatch === undefined) return code;
  const repaired = warnSealingKeyMismatch(store, options, mismatch);
  return code === EXIT_OK && repaired
    ? EXIT_SEALING_KEY_REPAIRED
    : EXIT_SEALING_KEY_MISMATCH_INCOMPLETE;
}

async function changeWith(
  store: IKeyringStore,
  stored: IKeyring,
  terminalSession: ISecretTerminalSession,
  holder: KeyHolder,
  credential: TCredentialKind,
  options: ISecureCommandOptions,
  onMismatch: (found: ISealingKeyMismatch) => void,
): Promise<number> {
  const result = await terminalSession.run(async (terminal) => {
    const opened = await unlockAtTerminal(terminal, holder, credential);
    if (opened === undefined) return undefined;
    const derived = fingerprint(holder.sealingPublicKey());
    if (opened.sealingKey === 'repaired') onMismatch({ stored: fingerprintOf(stored), derived });
    // The new slot is built on the file as it is now, which unlocking may just have repaired; the
    // save replaces exactly this keyring, so a change made meanwhile by anything else is not undone.
    const current = store.load();
    if (current.status === 'missing') return undefined;
    if (fingerprintOf(current.keyring) !== derived) {
      onMismatch({ stored: fingerprintOf(current.keyring), derived });
    }
    const next = await readNewPassphrase(terminal);
    if (next === undefined) return undefined;
    const changed = await changePassphrase(current.keyring, opened.credential, next);
    // The document carries the key the unlock verified, never one the file was given.
    return { expected: current.keyring, updated: holder.withVerifiedSealingKey(changed) };
  });
  if (result === undefined) {
    options.stderr('The passphrase was not changed.\n');
    return EXIT_FAILED;
  }
  store.save(result.updated, result.expected);
  options.stdout(
    [
      'The passphrase was changed. The recovery key and everything sealed to this keyring are unchanged.',
      'The same keys were wrapped again under the new passphrase, so a',
      'copy of the keyring file taken earlier still opens with the old passphrase;',
      'this file remains the only copy of your keys.',
      `Sealing public key fingerprint: ${fingerprint(holder.sealingPublicKey())}`,
    ].join('\n') + '\n',
  );
  return EXIT_OK;
}

export async function runSecureCommand(
  args: readonly string[],
  options: ISecureCommandOptions,
): Promise<number> {
  const cliName = options.productRuntime.vocabulary.cliName;
  const parsed = parseSecureArgs(args);
  if (parsed === undefined) {
    options.stderr(SECURE_USAGE(cliName));
    return EXIT_FAILED;
  }
  if (
    (parsed.action === 'migrate' || parsed.action === 'compact') &&
    !productSecureMode(options.productRuntime)
  ) {
    options.stderr(SECURE_MODE_OFF(cliName, parsed.action));
    return EXIT_FAILED;
  }
  const paths = userPaths(options.productRuntime);
  const store =
    options.store ??
    createKeyringFileStore({
      path: paths.keyring,
      root: options.productRuntime.layout.userRoot,
    });
  try {
    if (parsed.action === 'status') return runStatus(store, options);
    if (parsed.action === 'disable') return await runDisable(options);
    if (parsed.action === 'lock') {
      const root = resolveSupervisedDirectory(options.productRuntime);
      const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true });
      const targets = rows.filter((row): row is typeof row & { readonly generation: string } =>
        row.liveness === 'alive' && row.control === 'available' && row.generation !== undefined);
      const results = await Promise.allSettled(targets.map((row) => lockSupervisedSession(row.id, root, row.generation)));
      const failed = results.filter((result) => result.status === 'rejected').length +
        rows.filter((row) => row.liveness !== 'dead' && row.control === 'unavailable').length;
      if (failed > 0) {
        options.stderr(`Could not confirm locking ${failed} runtime(s).\n`);
        return EXIT_FAILED;
      }
      if (targets.length > 0) {
        options.stderr(`Lock requested from ${targets.length} runtime(s), but this command cannot verify runtime identity or lock state.\n`);
        return EXIT_FAILED;
      }
      options.stdout('No live registered runtimes found.\n');
      return EXIT_OK;
    }

    // Everything below asks for a secret, which is typed at an interactive terminal or not at all.
    const needsTerminal = `${cliName} secure ${parsed.action} needs an interactive terminal: run it in a terminal window, where you type the secret yourself.\n`;
    if (!(options.stdinIsTTY ?? process.stdin.isTTY === true)) {
      options.stderr(needsTerminal);
      return EXIT_FAILED;
    }
    if (parsed.action === 'setup' && !(options.stdoutIsTTY ?? process.stdout.isTTY === true)) {
      options.stderr(
        `${cliName} secure setup shows the recovery key once, so its output must be your terminal and not a file or a pipe: run it in a terminal without redirecting output.\n`,
      );
      return EXIT_FAILED;
    }
    const terminalSession = (options.openTerminal ?? openSecureTerminal)();
    if (terminalSession === undefined) {
      options.stderr(needsTerminal);
      return EXIT_FAILED;
    }
    if (parsed.action === 'setup') return await runSetup(store, terminalSession, options);
    if (parsed.action === 'migrate') {
      return await runSecureMigrate(store, terminalSession, parsed.dryRun, options);
    }
    if (parsed.action === 'enable') {
      return await runSecureEnable(store, terminalSession, options);
    }
    if (parsed.action === 'compact') return await runSecureCompact(store, terminalSession, options);
    return parsed.action === 'verify'
      ? await runVerify(store, terminalSession, parsed.credential, options)
      : await runChangePassphrase(store, terminalSession, parsed.credential, options);
  } catch (error) {
    options.stderr(`${describeFailure(error, parsed.action, cliName)}\n`);
    return EXIT_FAILED;
  }
}
