/** Total decoding for session-owned self-paced loops. */

import { addIssue, atKey, setOptional } from './decode-outcome.js';
import {
  decodeBoolean,
  decodeDeclaredObject,
  decodeInteger,
  decodeLiteral,
  decodeOptional,
  decodeString,
  decodeTimestampString,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type { ISessionLoopState, TSessionLoopPhase } from '@robota-sdk/agent-interface-session';

const PHASES: readonly TSessionLoopPhase[] = [
  'waiting',
  'pending',
  'running',
  'stopped',
  'expired',
];

const KEYS = [
  'loopId',
  'instruction',
  'useDefaultPrompt',
  'createdAt',
  'expiresAt',
  'revision',
  'generation',
  'phase',
  'nextAllowedAt',
  'delaySeconds',
  'reason',
  'fallbackUsed',
  'terminalReason',
] as const;

export function decodeSessionLoopState(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): ISessionLoopState | undefined {
  const raw = decodeDeclaredObject(value, path, issues, KEYS);
  if (!raw) return undefined;
  const loopId = decodeString(raw['loopId'], atKey(path, 'loopId'), issues);
  const instruction = decodeString(raw['instruction'], atKey(path, 'instruction'), issues);
  const useDefaultPrompt = decodeOptional(
    raw['useDefaultPrompt'], atKey(path, 'useDefaultPrompt'), issues, decodeBoolean,
  );
  const createdAt = decodeTimestampString(raw['createdAt'], atKey(path, 'createdAt'), issues);
  const expiresAt = decodeTimestampString(raw['expiresAt'], atKey(path, 'expiresAt'), issues);
  const revision = decodeInteger(raw['revision'], atKey(path, 'revision'), issues);
  const generation = decodeInteger(raw['generation'], atKey(path, 'generation'), issues);
  const phase = decodeLiteral(raw['phase'], PHASES, atKey(path, 'phase'), issues);
  const fallbackUsed = decodeBoolean(raw['fallbackUsed'], atKey(path, 'fallbackUsed'), issues);
  const nextAllowedAt = decodeOptional(
    raw['nextAllowedAt'],
    atKey(path, 'nextAllowedAt'),
    issues,
    decodeTimestampString,
  );
  const delaySeconds = decodeOptional(
    raw['delaySeconds'],
    atKey(path, 'delaySeconds'),
    issues,
    decodeInteger,
  );
  const reason = decodeOptional(raw['reason'], atKey(path, 'reason'), issues, decodeString);
  const terminalReason = decodeOptional(
    raw['terminalReason'],
    atKey(path, 'terminalReason'),
    issues,
    decodeString,
  );

  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
    addIssue(issues, atKey(path, 'revision'), 'expected a non-negative safe integer');
  }
  if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 0)) {
    addIssue(issues, atKey(path, 'generation'), 'expected a non-negative safe integer');
  }
  if (delaySeconds !== undefined && (delaySeconds < 60 || delaySeconds > 3600)) {
    addIssue(issues, atKey(path, 'delaySeconds'), 'expected a delay between 60 and 3600 seconds');
  }
  if (loopId !== undefined && !loopId.trim()) {
    addIssue(issues, atKey(path, 'loopId'), 'expected a non-empty loop ID');
  }
  if (instruction !== undefined && !instruction.trim()) {
    addIssue(issues, atKey(path, 'instruction'), 'expected a non-empty instruction');
  }
  if (phase === 'waiting' && nextAllowedAt === undefined && raw['nextAllowedAt'] === undefined) {
    addIssue(issues, atKey(path, 'nextAllowedAt'), 'waiting loop needs a next wake time');
  }
  if (
    loopId === undefined ||
    instruction === undefined ||
    createdAt === undefined ||
    expiresAt === undefined ||
    revision === undefined ||
    generation === undefined ||
    phase === undefined ||
    fallbackUsed === undefined
  ) {
    return undefined;
  }
  const state: ISessionLoopState = {
    loopId,
    instruction,
    createdAt,
    expiresAt,
    revision,
    generation,
    phase,
    fallbackUsed,
  };
  setOptional(state, 'useDefaultPrompt', useDefaultPrompt);
  setOptional(state, 'nextAllowedAt', nextAllowedAt);
  setOptional(state, 'delaySeconds', delaySeconds);
  setOptional(state, 'reason', reason);
  setOptional(state, 'terminalReason', terminalReason);
  return state;
}
