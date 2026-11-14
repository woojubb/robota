/**
 * What is said and asked on the secret terminal for the keyring commands. Every secret stays in a
 * local variable of these functions and the command that called them: nothing here logs, returns or
 * repeats what was typed, and the recovery key is written to the terminal and nowhere else.
 */
import {
  KeyringError,
  unlockWithRecoveryKey,
  type IKeyring,
  type TKeyringCredential,
} from '@robota-sdk/agent-keyring';

import { PASSPHRASE_RULE_EXPLANATION, passphraseProblem } from '@robota-sdk/agent-local-host';

import type { ISecretTerminal } from '../devices/secret-terminal.js';
import type { KeyHolder, TSealingKeyOutcome } from '@robota-sdk/agent-local-host';

/** Raw mode does no newline translation, so lines on the secret terminal end with CRLF. */
const NL = '\r\n';
const NEW_PASSPHRASE_ATTEMPTS = 3;
export const UNLOCK_ATTEMPTS = 3;
const RECOVERY_CONFIRM_ATTEMPTS = 3;

export type TCredentialKind = TKeyringCredential['type'];

/** A new passphrase, typed twice and long enough; `undefined` when the attempts ran out. */
export async function readNewPassphrase(terminal: ISecretTerminal): Promise<string | undefined> {
  terminal.write(`${PASSPHRASE_RULE_EXPLANATION}${NL}Nothing you type is shown.${NL}${NL}`);
  for (let attempt = 1; attempt <= NEW_PASSPHRASE_ATTEMPTS; attempt += 1) {
    const first = await terminal.readLine('New passphrase: ');
    const problem = passphraseProblem(first);
    if (problem !== undefined) {
      terminal.write(`${problem}${NL}`);
      continue;
    }
    const second = await terminal.readLine('Repeat the passphrase: ');
    if (second === first) return first;
    terminal.write(`The two entries differ.${NL}`);
  }
  return undefined;
}

/**
 * Show a new recovery key once, clear it from the screen and have it typed back, so a key that was
 * miscopied is found now and not on the day it is needed. The typed key is checked by opening the
 * keyring with it, not by comparing text.
 */
export async function presentRecoveryKey(
  terminal: ISecretTerminal,
  keyring: IKeyring,
  recoveryKey: string,
): Promise<boolean> {
  terminal.write(
    [
      'Your recovery key. It is shown once, here only, and is not stored anywhere.',
      'Write it down and keep it offline. If you forget your passphrase it is the only way back in; if',
      'you lose both, everything sealed to this keyring stays unreadable for good.',
      '',
      `  ${recoveryKey}`,
      '',
      '',
    ].join(NL),
  );
  await terminal.readLine('Press Enter once it is written down. ');
  terminal.clearScreen();
  for (let attempt = 1; attempt <= RECOVERY_CONFIRM_ATTEMPTS; attempt += 1) {
    const typed = await terminal.readLine(
      'To confirm, type the recovery key (nothing is shown as you type): ',
    );
    try {
      (await unlockWithRecoveryKey(keyring, typed)).lock();
      return true;
    } catch (error) {
      if (!(error instanceof KeyringError)) throw error;
      terminal.write(`That is not the recovery key that was shown.${NL}`);
    }
  }
  return false;
}

/** The refusal to tell the person, for a credential that was typed wrong; other errors are not theirs to retry. */
export function retryableRefusal(error: unknown): string | undefined {
  if (!(error instanceof KeyringError)) return undefined;
  switch (error.code) {
    case 'wrong-credential':
      return 'That did not unlock the keyring.';
    case 'empty-passphrase':
      return 'Nothing was entered.';
    case 'invalid-recovery-key':
      return 'That is not in the form of a recovery key.';
    default:
      return undefined;
  }
}

export interface IUnlockedAtTerminal {
  readonly credential: TKeyringCredential;
  readonly sealingKey: TSealingKeyOutcome;
}

/**
 * Ask for the passphrase (or the recovery key) and open the keyring with it, a few tries. A wrong
 * credential and a tampered slot read the same, by design. The holder is left unlocked on success.
 */
export async function unlockAtTerminal(
  terminal: ISecretTerminal,
  holder: KeyHolder,
  kind: TCredentialKind,
): Promise<IUnlockedAtTerminal | undefined> {
  for (let attempt = 1; attempt <= UNLOCK_ATTEMPTS; attempt += 1) {
    const typed = await terminal.readLine(
      kind === 'passphrase' ? 'Passphrase: ' : 'Recovery key (nothing is shown as you type): ',
    );
    const credential: TKeyringCredential =
      kind === 'passphrase'
        ? { type: 'passphrase', passphrase: typed }
        : { type: 'recoveryKey', recoveryKey: typed };
    try {
      const { sealingKey } = await holder.unlock(credential);
      return { credential, sealingKey };
    } catch (error) {
      const refusal = retryableRefusal(error);
      if (refusal === undefined) throw error;
      terminal.write(`${refusal}${NL}`);
    }
  }
  return undefined;
}
