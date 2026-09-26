/**
 * The enrollment conversations on the secret terminal: showing the one-time code on the existing
 * device, reading it on the new one, and asking each operator whether the other device shows the
 * same digits. The code is written and read here and nowhere else; the screen is wiped once it has
 * been read.
 */
import { normalizeEnrollmentCode } from '@robota-sdk/agent-remote-pairing';

import { SecretInputCancelled, type ISecretTerminal } from './secret-terminal.js';

import type { IEnrollmentOperator } from './device-enrollment.js';

const NL = '\r\n';

/**
 * Keep a prompt open until `stop` aborts, so ctrl-C at the terminal cancels the wait; Enter does
 * nothing. The returned signal aborts on ctrl-C. Only one read is open at a time, so `stop` must
 * abort before the terminal asks anything else.
 */
function cancellable(terminal: ISecretTerminal, prompt: string, stop: AbortSignal): AbortSignal {
  const cancelled = new AbortController();
  void (async () => {
    try {
      // The prompt once; a stray Enter does not print it again.
      await terminal.readLine(prompt, { signal: stop });
      for (;;) await terminal.readLine('', { signal: stop });
    } catch {
      if (!stop.aborted) cancelled.abort();
    }
  })();
  return cancelled.signal;
}

/** Wait for `pending` while ctrl-C cancels; rejects with {@link SecretInputCancelled} then. */
async function waiting<T>(terminal: ISecretTerminal, pending: Promise<T>): Promise<T> {
  const stop = new AbortController();
  const cancelled = cancellable(
    terminal,
    'Waiting for the other device… (ctrl-C cancels) ',
    stop.signal,
  );
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) =>
        cancelled.addEventListener('abort', () => reject(new SecretInputCancelled()), {
          once: true,
        }),
      ),
    ]);
  } finally {
    stop.abort();
  }
}

function clock(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 5);
}

export interface IAddDialog extends IEnrollmentOperator {
  readonly showCode: (code: string, expiresAt: number) => void;
  /** Aborts when the operator cancels while waiting for a device. */
  readonly cancelled: AbortSignal;
  /** Close any open prompt. */
  readonly end: () => void;
}

/** The existing device's side: show the code, wait, and ask about the device that proved it. */
export function addDialog(terminal: ISecretTerminal): IAddDialog {
  const waitingForDevice = new AbortController();
  const cancelled = new AbortController();
  return {
    cancelled: cancelled.signal,
    showCode: (code, expiresAt) => {
      terminal.write(
        [
          'Enrol another device.',
          '',
          'On the new device, run /devices join and type this code:',
          '',
          `    ${code}`,
          '',
          `It works once, until ${clock(expiresAt)}. Type it nowhere else.`,
          '',
          '',
        ].join(NL),
      );
      cancellable(
        terminal,
        'Waiting for the new device… (ctrl-C cancels) ',
        waitingForDevice.signal,
      ).addEventListener('abort', () => cancelled.abort(), { once: true });
    },
    confirm: async ({ name, sas, signal }) => {
      waitingForDevice.abort();
      // The code is spent; take it off the screen before anything else is shown.
      terminal.clearScreen();
      terminal.write(
        [
          `A device asks to join: "${name ?? ''}"`,
          '',
          `It should show this code:  ${sas}`,
          '',
          'If it does not, or you did not start it, decline.',
          '',
          '',
        ].join(NL),
      );
      const answer = await terminal.readLine('Type yes to enrol it, anything else to decline: ', {
        echo: true,
        signal,
      });
      return answer.trim().toLowerCase() === 'yes';
    },
    waitForPeer: (pending) => waiting(terminal, pending),
    end: () => waitingForDevice.abort(),
  };
}

export interface IJoinDialog extends IEnrollmentOperator {
  /** The canonical code, or `undefined` when what was typed is not one. */
  readonly code: string | undefined;
  /** Aborts when the operator cancels while connecting. */
  readonly cancelled: AbortSignal;
  readonly end: () => void;
}

/** The new device's side: read the code, then ask whether the other device shows the same digits. */
export async function joinDialog(terminal: ISecretTerminal): Promise<IJoinDialog> {
  terminal.write(
    [
      'Join your devices.',
      '',
      'On a device that holds your signing key, run /devices add.',
      '',
      '',
    ].join(NL),
  );
  const typed = await terminal.readLine('Type the code it shows: ', { echo: true });
  terminal.clearScreen();
  const code = normalizeEnrollmentCode(typed);
  const connecting = new AbortController();
  const cancelled =
    code === undefined
      ? new AbortController().signal
      : cancellable(terminal, 'Connecting… (ctrl-C cancels)' + NL, connecting.signal);
  return {
    code,
    cancelled,
    confirm: async ({ sas, signal }) => {
      connecting.abort();
      terminal.write(
        [
          '',
          `Your other device should show:  ${sas}`,
          'It should also ask whether to enrol this device.',
          '',
          '',
        ].join(NL),
      );
      const answer = await terminal.readLine(
        'If both are true, type yes to join; anything else declines: ',
        { echo: true, signal },
      );
      return answer.trim().toLowerCase() === 'yes';
    },
    waitForPeer: (pending) => waiting(terminal, pending),
    end: () => connecting.abort(),
  };
}
