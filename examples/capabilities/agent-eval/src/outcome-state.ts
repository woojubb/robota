export interface IStateObservation {
  readonly value: string;
  readonly revision: string;
  readonly effects: number;
  readonly calls: readonly string[];
}

/** A failed stale operation must independently preserve the actual state and observation chain. */
export function assertStaleState(state: IStateObservation): void {
  if (
    state.value !== 'off' ||
    state.revision !== 'revision-0' ||
    state.effects !== 0 ||
    state.calls.join(',') !== 'observe,observe'
  ) {
    throw new Error(
      'Stale operation changed state, duplicated an effect, or lost observation order',
    );
  }
}
