import { createRuntimeIdentity, type IRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { answerSpawnerPair } from '@robota-sdk/agent-transport/link';

/** The argument a secure supervised launch adds when it hands the child the pair its spawner holds. */
export const SUPERVISED_SPAWNER_PAIR_FLAG = '--supervised-spawner-pair';

/**
 * The runtime's identity after the one exchange with its spawner, over the pair it inherited: the
 * first thing a secure supervised runtime does, before it starts any process, because the pair is
 * the one channel only the two of them hold. The descriptor is closed when this returns, whatever
 * happened. Throws, without anything that was exchanged, when the exchange could not be done.
 */
export function answerHandedOverSpawnerPair(): IRuntimeIdentity {
  const identity = createRuntimeIdentity();
  answerSpawnerPair(identity);
  return identity;
}
