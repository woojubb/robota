import type { IProviderDefinition, IToolWithEventService } from '@robota-sdk/agent-core';

/**
 * ARCH-021: what the product composes, stated by the composition root.
 *
 * This is the sibling of {@link ISubagentWorkerEntry} one level up. That seam answers "how is this
 * artifact started"; this one answers "what does this product compose" — and the same rule decides
 * both: **the only party that knows is the product itself.**
 *
 * The seam this replaces had a neutral package importing `createDefaultTools()` and
 * `createDefaultProviderDefinitions()` and building the child's surface from them, while the
 * composition root had already handed the runner the fully composed surface. So a product's custom
 * providers and pack-owned tools reached an in-process subagent and not a child-process one, and
 * ARCH-006's invariant — every tool robota runs comes from a pack — was false in the child.
 *
 * **Why a recipe rather than the instances.** A composition cannot be projected across a process
 * boundary, because it is code: `createProvider` is a function and a tool carries `execute`. The two
 * structurally sound answers are to proxy the instances or to stop expressing the contract as
 * instances. Proxying loses on containment — a proxied tool executes in the PARENT, bound to the
 * parent's checkout, while a worktree-isolated child's execution root is a different directory. So
 * the recipe crosses and the child builds an equivalent surface at its own root, which is what every
 * comparable product does.
 */
export interface ISubagentWorkerComposition {
  /**
   * The product's tool surface for THIS subagent's execution root.
   *
   * `cwd` is a required argument for the same reason `ICreateDefaultToolsOptions.cwd` is (ARCH-010):
   * a tool set built without its root carries a disarmed path guard, and the measured consequence
   * was a subagent `Read` returning `/etc/hostname`. Passing the root through the call rather than
   * capturing it in the factory is what stops a child from inheriting the parent's.
   */
  createTools(context: { readonly cwd: string }): IToolWithEventService[];

  /**
   * The product's provider registry. Carried as definitions rather than a constructed provider
   * because `createProvider` is code — the child builds its own provider from the serialized profile
   * against THIS registry, so a custom provider type resolves instead of throwing `Unknown provider`.
   */
  readonly providerDefinitions: readonly IProviderDefinition[];
}
