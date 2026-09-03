import type { IAssembledProduct } from '@robota-sdk/agent-product';

/**
 * CLI-078 (issue #2443): the runner collaborators every mode receives are the ones ASSEMBLY returned.
 *
 * Decision recorded here: `backgroundTaskRunners` and `subagentRunnerFactory` are product-fold
 * OUTPUTS, not shell exceptions. The shell still constructs them (the fold takes them as profile
 * inputs — it cannot build a child-process runner, which is a packaging decision), but the values
 * the modes bind to come out of `assembleProduct`, so "every surface binds to the one assembled
 * result" is true of them as it is of command modules, agent definitions and tools.
 *
 * The fold passes both through by identity. This binding VERIFIES that rather than assuming it: a
 * fold that one day substitutes a collaborator would otherwise leave the modes on the shell's input
 * while the product carried something else — the split CLI-078 was filed for, reintroduced silently.
 *
 * `TInput` keeps the shell's narrower types (the child-process factory) for the modes' signatures.
 */
export interface IShellRunnerCollaborators<TFactory> {
  readonly backgroundTaskRunners: IAssembledProduct['backgroundTaskRunners'];
  readonly subagentRunnerFactory: TFactory;
}

export function bindAssembledCollaborators<
  TFactory extends IAssembledProduct['subagentRunnerFactory'],
>(
  product: Pick<IAssembledProduct, 'backgroundTaskRunners' | 'subagentRunnerFactory'>,
  input: IShellRunnerCollaborators<TFactory>,
): IShellRunnerCollaborators<TFactory> {
  if (product.subagentRunnerFactory !== input.subagentRunnerFactory) {
    throw new Error(
      'assembleProduct returned a subagent runner factory other than the one the profile supplied; ' +
        'the modes must bind to the assembled collaborator, so this is refused rather than papered over.',
    );
  }
  const sameRunners =
    product.backgroundTaskRunners.length === input.backgroundTaskRunners.length &&
    product.backgroundTaskRunners.every((runner, i) => runner === input.backgroundTaskRunners[i]);
  if (!sameRunners) {
    throw new Error(
      'assembleProduct returned background task runners other than the ones the profile supplied; ' +
        'the modes must bind to the assembled collaborators.',
    );
  }
  return {
    backgroundTaskRunners: product.backgroundTaskRunners,
    subagentRunnerFactory: input.subagentRunnerFactory,
  };
}
