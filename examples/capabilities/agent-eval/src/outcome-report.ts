/** Consumer-owned trial aggregation. Unknown pricing must not become zero cost. */
export interface IOutcomeTrial {
  readonly success: boolean;
  readonly costUsd: number | null;
}

export function summarizeTrials(trials: readonly IOutcomeTrial[]) {
  for (const trial of trials) {
    if (trial.costUsd !== null && (!Number.isFinite(trial.costUsd) || trial.costUsd < 0)) {
      throw new Error('Trial cost must be finite and nonnegative, or null for unknown pricing');
    }
  }
  const successes = trials.filter((trial) => trial.success).length;
  const totalCostUsd =
    trials.length > 0 && trials.every((trial) => trial.costUsd !== null)
      ? trials.reduce((sum, trial) => sum + (trial.costUsd ?? 0), 0)
      : null;
  return {
    sampleSize: trials.length,
    successes,
    successRate: trials.length === 0 ? null : successes / trials.length,
    totalCostUsd,
    costPerSuccess: totalCostUsd !== null && successes > 0 ? totalCostUsd / successes : null,
  };
}
