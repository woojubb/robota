import { AcpParticipantError } from './errors';

/** The longest delay a timer honors; a larger one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** A positive integer a timer or a bound can honor; anything else is a configuration mistake. */
export function boundedOption(name: string, value: number | undefined, fallback: number): number {
  const chosen = value ?? fallback;
  if (!Number.isSafeInteger(chosen) || chosen < 1 || chosen > MAX_TIMER_MS) {
    throw new AcpParticipantError(
      'invalid-options',
      `${name} must be an integer from 1 to ${MAX_TIMER_MS}`,
    );
  }
  return chosen;
}
