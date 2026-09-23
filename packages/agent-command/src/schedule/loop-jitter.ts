import { createHash } from 'node:crypto';

/** Fixed loops are spread across a stable wall-clock slot; self-paced delays are not jittered. */
export function jitterFixedLoop(
  loopId: string,
  cadence: { description: string; milliseconds: number; cronExpression: string },
): { cronExpression: string; jitterSeconds: number } {
  const maxSeconds = Math.floor(Math.min(30 * 60, cadence.milliseconds / 2_000));
  const hash = createHash('sha256').update(loopId).digest().readUInt32BE(0);
  const jitterSeconds = hash % (maxSeconds + 1);
  if (jitterSeconds === 0) return { cronExpression: cadence.cronExpression, jitterSeconds };

  const match = /^(\d+)(s|m|h)$/.exec(cadence.description);
  if (!match) throw new Error('Unsupported fixed-loop cadence for jitter.');
  const step = Number(match[1]);
  const unit = match[2];
  const second = jitterSeconds % 60;
  const minute = Math.floor(jitterSeconds / 60);
  if (unit === 's') {
    return {
      cronExpression: step === 60
        ? `${jitterSeconds} * * * * *`
        : `${jitterSeconds}-59/${step} * * * * *`,
      jitterSeconds,
    };
  }
  if (unit === 'm') {
    return {
      cronExpression: step === 60
        ? `${second} ${minute} * * * *`
        : `${second} ${minute}-59/${step} * * * *`,
      jitterSeconds,
    };
  }
  return {
    cronExpression: step === 24
      ? `${second} ${minute} 0 * * *`
      : `${second} ${minute} */${step} * * *`,
    jitterSeconds,
  };
}
