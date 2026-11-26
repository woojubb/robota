/**
 * The local unlock gate: where this process asks for the passphrase, and whether it may ask at all.
 *
 * Locked is write-only. A process asks only when a read the person started needs the keys — the
 * terminal UI's `ensureReadable`, whose request only its action modules can mint, and which refuses
 * one the mint did not make — or when the person
 * runs `/unlock`. It asks on the secret terminal while the live session has handed the terminal over,
 * so nothing typed reaches the session's input, prompt history or conversation; and it never waits
 * where nobody can answer: without a live session that can hand its terminal over, or without a
 * secret terminal, the answer is `unavailable` at once. One question is open at a time, and a read
 * started while it is open waits for that answer instead of asking again.
 *
 * Only a process given a key holder in secure mode has a custody (`productKeyCustody`), and the
 * composition builds one for the terminal UI alone: the locked holder of a surface that never unlocks
 * (print mode, ACP, MCP over stdio) gets none. Everywhere else there is none, so no read, listing or
 * command behaves differently.
 *
 * The keys it opens live as long as the person is at the terminal: the holder locks them after its
 * idle bound, counted from the last key the terminal's input stream carried, because the idle lock
 * exists for a person who walked away. The stream is watched only while the keys are open, and only
 * the keys count: not output, not a timer, not what the model does, not the terminal's own focus
 * reports.
 */
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { fingerprint } from '@robota-sdk/agent-keyring';
import { isUserReadRequest } from '@robota-sdk/agent-ui-terminal';

import { SecretInputCancelled } from '../devices/secret-terminal.js';
import { isInspectorOpen } from '../process-hardening.js';
import { terminalHandoffHostOf } from '../remote-control/operator-approval.js';
import { SealingKeyMismatchError } from '@robota-sdk/agent-local-host';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import {
  describeMismatchFailure,
  fingerprintOf,
  missingKeyring,
  mismatchOf,
  warnSealingKeyMismatch,
  type ISealingKeyMismatch,
} from '../secure/sealing-key-warning.js';
import { unlockAtTerminal } from '../secure/secure-conversations.js';
import { openSecureTerminal } from '../secure/secure-terminal.js';
import { productKeyHolder } from './session-sealing.js';
import { userPaths } from './user-paths.js';

import type { ICliRuntimeContext } from './runtime-context.js';
import type { ISecretTerminal, ISecretTerminalSession } from '../devices/secret-terminal.js';
import type { ITerminalHandoffHost } from '../remote-control/operator-approval.js';
import type { KeyHolder } from '@robota-sdk/agent-local-host';
import type { IKeyringStore } from '@robota-sdk/agent-local-host';
import type { IKeyCustodyCommandPort, IUnlockResult } from '@robota-sdk/agent-product/command';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface/session';
import type {
  IKeyCustodyPort,
  TReadability,
  TReadPurpose,
  TUserReadRequest,
} from '@robota-sdk/agent-ui-terminal';

/** Raw mode does no newline translation, so lines on the secret terminal end with CRLF. */
const NL = '\r\n';

/**
 * The line the secret terminal shows above the prompt, per purpose. Keyed by the UI's purpose type,
 * so a purpose added there does not compile until it is worded here.
 */
export const READ_PURPOSES: { readonly [P in TReadPurpose]: string } = {
  'continue-fork': 'Unlock to continue the forked conversation; it is sealed to your keyring.',
  'follow-history': 'Unlock to read the earlier fork conversation; it is sealed to your keyring.',
};

/** Said in the session when the idle lock closed the keys, which nothing the person did announced. */
export const IDLE_LOCK_NOTICE =
  'Locked: no key was typed here for a while, so sealed sessions cannot be read until `/unlock`; new conversations are still sealed as you go.';

/** Said instead of asking for the passphrase when this process has a debugger inspector open. */
export const INSPECTOR_OPEN_NOTICE =
  'The keys stay locked: this process has its debugger inspector open, which could read what you type and the keys it opens. Start it again without one.';

/** The line `/unlock` shows above the prompt. */
export const UNLOCK_COMMAND_LINE =
  'Unlock to read the conversations sealed to your keyring in this session.';

/** An unlock's answer, with what the person must hear about it outside the secret terminal. */
export interface IUnlockAnswer {
  readonly readability: TReadability;
  /** Said in the session after the terminal is back: a repaired or swapped sealing key, a missing keyring. */
  readonly notices: readonly string[];
}

/** Where the gate hands the terminal over and speaks: the live session the person is looking at. */
export interface IKeyCustodyChannel {
  /** The live session's terminal hand-off, or `undefined` when it cannot hand its terminal over. */
  host(): ITerminalHandoffHost | undefined;
  /** Say `message` in that session. */
  report(message: string): void;
}

export interface IProcessKeyCustody {
  /** What the terminal UI asks; see `IKeyCustodyPort`. */
  readonly port: IKeyCustodyPort;
  /**
   * What `/unlock` and `/lock` act through. `/unlock` has already handed the terminal over when it
   * calls `unlock`, so the gate asks on it without handing it over again; while unlocked it asks
   * nothing. Locking needs no proof: it only takes reading away.
   */
  readonly commands: IKeyCustodyCommandPort;
  /** The live session to ask through, as each one is created; `undefined` while there is none. */
  setChannel(channel: IKeyCustodyChannel | undefined): void;
}

export interface IProcessKeyCustodyOptions {
  readonly holder: KeyHolder;
  /** The keyring file the holder unlocks, read for what a found mismatch is told with. */
  readonly keyringStore: IKeyringStore;
  readonly productRuntime: ICliRuntimeContext;
  /** Defaults to this platform's secret terminal. */
  readonly openTerminal?: () => ISecretTerminalSession | undefined;
  /** Whether this process has a debugger inspector open; defaults to asking the runtime. */
  readonly inspectorOpen?: () => boolean;
  /**
   * The stream the person's keys arrive on, read when the keys open. Defaults to this process's stdin,
   * which the terminal UI reads too.
   */
  readonly input?: () => Pick<NodeJS.ReadableStream, 'on' | 'off'>;
}

/** The inspector opened between the question and the typed answer; the answer is dropped unread. */
class InspectorOpenedWhileAsking extends Error {
  constructor() {
    super(INSPECTOR_OPEN_NOTICE);
    this.name = 'InspectorOpenedWhileAsking';
  }
}

/** The sequences a terminal sends when its window gains or loses focus: the window system's, not a key. */
const FOCUS_REPORTS = ['\x1b[I', '\x1b[O'] as const;

/** Whether `chunk` carries a key the person typed, which a lone focus report does not. */
function carriesKeys(chunk: Buffer | string): boolean {
  let rest = typeof chunk === 'string' ? chunk : chunk.toString('latin1');
  for (const report of FOCUS_REPORTS) rest = rest.split(report).join('');
  return rest.length > 0;
}

const NOTHING: readonly string[] = [];

/** What a keyring command would have written to its error stream, as one notice. */
function said(
  productRuntime: ICliRuntimeContext,
  speak: (output: Parameters<typeof missingKeyring>[1]) => unknown,
): string {
  let text = '';
  const collect = (chunk: string): void => {
    text += chunk;
  };
  speak({ productRuntime, stdout: collect, stderr: collect });
  return text.trimEnd();
}

export function createProcessKeyCustody(options: IProcessKeyCustodyOptions): IProcessKeyCustody {
  const { holder, keyringStore: store, productRuntime } = options;
  const openTerminal = options.openTerminal ?? (() => openSecureTerminal());
  const keysInput = options.input ?? (() => process.stdin);
  const inspectorOpen = options.inspectorOpen ?? (() => isInspectorOpen());
  const cliName = productRuntime.vocabulary.cliName;
  let channel: IKeyCustodyChannel | undefined;
  let open: Promise<IUnlockAnswer> | undefined;

  const warning = (mismatch: ISealingKeyMismatch): string =>
    said(productRuntime, (output) => warnSealingKeyMismatch(store, output, mismatch));

  /**
   * `terminal`, except that a line typed while this process has an inspector open is dropped before
   * anything opens with it. The first check is made before the prompt, and a person takes seconds to
   * type, so it is made again here, after the typing and before the keyring is tried with the line:
   * the error leaves the unlock before a credential exists. A typed string cannot be overwritten in
   * JavaScript, so keeping it nowhere is all there is to do; the secret terminal discards what it
   * held when it gives the terminal back.
   */
  const dropsLinesWhileInspected = (terminal: ISecretTerminal): ISecretTerminal => ({
    write: (text) => terminal.write(text),
    clearScreen: () => terminal.clearScreen(),
    readLine: async (prompt, readOptions) => {
      const typed = await terminal.readLine(prompt, readOptions);
      if (inspectorOpen()) throw new InspectorOpenedWhileAsking();
      return typed;
    },
  });

  /** One question on a terminal already handed over: the passphrase, a few tries, as `secure verify` asks. */
  const askHere = async (line: string): Promise<IUnlockAnswer> => {
    // Nothing is asked in a process a debugger can read: the passphrase and the keys would be in it.
    if (inspectorOpen()) return { readability: 'unavailable', notices: [INSPECTOR_OPEN_NOTICE] };
    const before = store.load();
    if (before.status === 'missing') {
      return {
        readability: 'unavailable',
        notices: [said(productRuntime, (output) => missingKeyring(store, output))],
      };
    }
    const session = openTerminal();
    if (session === undefined) return { readability: 'unavailable', notices: NOTHING };
    try {
      const opened = await session.run(async (terminal) => {
        terminal.write(`${line}${NL}Nothing you type is shown.${NL}${NL}`);
        return unlockAtTerminal(dropsLinesWhileInspected(terminal), holder, 'passphrase');
      });
      if (opened === undefined) return { readability: 'declined', notices: NOTHING };
      if (opened.sealingKey !== 'repaired') return { readability: 'readable', notices: NOTHING };
      return {
        readability: 'readable',
        notices: [
          warning({
            stored: fingerprintOf(before.keyring),
            derived: fingerprint(holder.sealingPublicKey()),
          }),
        ],
      };
    } catch (error) {
      if (error instanceof InspectorOpenedWhileAsking) {
        return { readability: 'unavailable', notices: [INSPECTOR_OPEN_NOTICE] };
      }
      if (error instanceof SecretInputCancelled) {
        return { readability: 'declined', notices: NOTHING };
      }
      if (error instanceof SealingKeyMismatchError) {
        return {
          readability: 'declined',
          notices: [describeMismatchFailure(error, cliName), warning(mismatchOf(error))],
        };
      }
      throw error;
    }
  };

  /** Whatever stopped the question before an answer: the keys stay locked, and the person is told why. */
  const stopped = (error: unknown): IUnlockAnswer => ({
    readability: 'unavailable',
    notices: [
      `The keys stay locked: ${error instanceof Error ? error.message : 'the passphrase could not be asked for'}.`,
    ],
  });

  /** Runs `ask` as the one open question; see {@link joinOpen} for a read started meanwhile. */
  const start = (ask: () => Promise<IUnlockAnswer>): Promise<IUnlockAnswer> => {
    const answer = ask().catch(stopped);
    open = answer;
    void answer.finally(() => {
      if (open === answer) open = undefined;
    });
    return answer;
  };

  /** The open question's answer, for a read that waited for it; its notices were said once already. */
  const joinOpen = async (question: Promise<IUnlockAnswer>): Promise<IUnlockAnswer> => ({
    readability: (await question).readability,
    notices: NOTHING,
  });

  const port: IKeyCustodyPort = {
    async ensureReadable(request: TUserReadRequest): Promise<TReadability> {
      // The type admits a cast; the mint's record does not. A request it did not make asks nothing
      // and says nothing about the keys.
      if (!isUserReadRequest(request)) return 'unavailable';
      if (holder.isUnlocked) return 'readable';
      if (open !== undefined) return (await joinOpen(open)).readability;
      const current = channel;
      const host = current?.host();
      if (host === undefined || !host.canHandoffTerminal()) return 'unavailable';
      const answer = await start(() =>
        host.runWithTerminal(() => askHere(READ_PURPOSES[request.purpose])),
      );
      for (const notice of answer.notices) current?.report(notice);
      return answer.readability;
    },
  };

  // The person is at the terminal while keys reach its input. Watched only while the keys are open,
  // so a locked process holds no reader of its own on the stream the terminal UI reads.
  let watched: Pick<NodeJS.ReadableStream, 'on' | 'off'> | undefined;
  const onKeys = (chunk: Buffer | string): void => {
    if (carriesKeys(chunk)) holder.touch();
  };
  const watchKeys = (): void => {
    if (watched !== undefined) return;
    watched = keysInput();
    watched.on('data', onKeys);
  };
  holder.onUnlock(watchKeys);
  if (holder.isUnlocked) watchKeys();
  holder.onLock((reason) => {
    watched?.off('data', onKeys);
    watched = undefined;
    // Only the idle lock closes the keys without the person doing it, so only it is announced.
    if (reason === 'idle') channel?.report(IDLE_LOCK_NOTICE);
  });

  const commands: IKeyCustodyCommandPort = {
    isUnlocked: () => holder.isUnlocked,
    async unlock(): Promise<IUnlockResult> {
      if (holder.isUnlocked) return { outcome: 'unlocked', notices: NOTHING };
      const answer =
        open === undefined ? await start(() => askHere(UNLOCK_COMMAND_LINE)) : await joinOpen(open);
      return {
        outcome: answer.readability === 'readable' ? 'unlocked' : answer.readability,
        notices: answer.notices,
      };
    },
    lock: () => holder.lock('explicit'),
  };

  return {
    port,
    commands,
    setChannel: (next) => {
      channel = next;
    },
  };
}

/** The live TUI channel, as far as the gate needs it (structural — no coupling to the class). */
export interface ILiveKeyCustodyChannel {
  getSession(): IInteractiveSession;
  readonly stateManager: { addEntry(entry: IHistoryEntry): void };
}

/** The gate's view of a live TUI channel: its session's hand-off, and its history for notices. */
export function keyCustodyChannelOf(live: ILiveKeyCustodyChannel): IKeyCustodyChannel {
  return {
    host: () => terminalHandoffHostOf(live.getSession()),
    report: (message) =>
      live.stateManager.addEntry(messageToHistoryEntry(createSystemMessage(message))),
  };
}

/**
 * `runtime`'s custody, or `undefined` unless secure mode is on for it and it was given a key holder
 * (`useProductKeyHolder`), so the gate is never live before the stores seal. Asking for it is the
 * terminal UI's alone; a process whose surface never unlocks does not ask.
 */
export function productKeyCustody(
  runtime: ICliRuntimeContext,
  options: {
    readonly openTerminal?: () => ISecretTerminalSession | undefined;
    readonly input?: IProcessKeyCustodyOptions['input'];
    readonly inspectorOpen?: IProcessKeyCustodyOptions['inspectorOpen'];
  } = {},
): IProcessKeyCustody | undefined {
  const holder = productKeyHolder(runtime);
  if (holder === undefined) return undefined;
  return createProcessKeyCustody({
    holder,
    keyringStore: createKeyringFileStore({
      path: userPaths(runtime).keyring,
      root: runtime.layout.userRoot,
    }),
    productRuntime: runtime,
    ...(options.openTerminal === undefined ? {} : { openTerminal: options.openTerminal }),
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.inspectorOpen === undefined ? {} : { inspectorOpen: options.inspectorOpen }),
  });
}
