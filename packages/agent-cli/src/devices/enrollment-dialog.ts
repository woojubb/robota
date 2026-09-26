/**
 * The enrollment conversations on the secret terminal: showing the one-time code on the existing
 * device and asking its operator to confirm the new device, and reading the code on the new device.
 * The code is written and read here and nowhere else; the screen is wiped once it has been read.
 */
import { normalizeEnrollmentCode } from '@robota-sdk/agent-remote-pairing';

import type { ISecretTerminal } from './secret-terminal.js';

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
      for (;;) await terminal.readLine(prompt, { signal: stop });
    } catch {
      if (!stop.aborted) cancelled.abort();
    }
  })();
  return cancelled.signal;
}

function clock(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 5);
}

export interface IAddDialog {
  readonly showCode: (code: string, expiresAt: number) => void;
  readonly confirm: (request: {
    readonly name: string;
    readonly sas: string;
    readonly signal: AbortSignal;
  }) => Promise<boolean>;
  /** Aborts when the operator cancels while waiting for a device. */
  readonly cancelled: AbortSignal;
  /** Close any open prompt. */
  readonly end: () => void;
}

/** The existing device's side: show the code, wait, and ask about the device that proved it. */
export function addDialog(terminal: ISecretTerminal): IAddDialog {
  const waiting = new AbortController();
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
        waiting.signal,
      ).addEventListener('abort', () => cancelled.abort(), { once: true });
    },
    confirm: async ({ name, sas, signal }) => {
      waiting.abort();
      // The code is spent; take it off the screen before anything else is shown.
      terminal.clearScreen();
      terminal.write(
        [
          `A device asks to join: "${name}"`,
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
    end: () => waiting.abort(),
  };
}

export interface IJoinDialog {
  /** The canonical code, or `undefined` when what was typed is not one. */
  readonly code: string | undefined;
  readonly showSas: (sas: string) => void;
  readonly cancelled: AbortSignal;
  readonly end: () => void;
}

/** The new device's side: read the code, then show the short string while the other side decides. */
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
  const waiting = new AbortController();
  const cancelled =
    code === undefined
      ? new AbortController().signal
      : cancellable(terminal, 'Connecting… (ctrl-C cancels)' + NL, waiting.signal);
  return {
    code,
    cancelled,
    showSas: (sas) => {
      terminal.write(
        ['', `Your other device should show:  ${sas}`, 'Confirm it there if it matches.', ''].join(
          NL,
        ),
      );
    },
    end: () => waiting.abort(),
  };
}
