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
  createTools(context: {
    readonly cwd: string;
    /**
     * ARCH-034: the tiers session assembly adds ON TOP of the product's tool set.
     *
     * The two runners of `ISubagentRunner` were handing a subagent different surfaces, and the
     * difference was silent because both paths succeed. In-process passes the parent's fully
     * ASSEMBLED tools; this path rebuilds the product's set at the child's root. For a product whose
     * packs own the tool surface those agree — but what session assembly adds AFTER the packs did
     * not cross: the goal tool (`includeGoalTool`) and edit-checkpoint wrapping.
     *
     * Choosing a runner is an isolation and packaging decision. It is not supposed to be a capability
     * decision, so the composition root states which of those tiers the child should also receive and
     * the recipe carries the answer rather than the parent's live wrappers.
     */
    readonly sessionTiers?: {
      /** Whether the parent's session included the goal-status tool. */
      readonly includeGoalTool?: boolean;
    };
    /**
     * ARCH-033: the sandbox the child restored, when the parent projected one.
     *
     * Threaded rather than captured, for the same reason `cwd` is: a tool surface built without the
     * sandbox it is supposed to act in would run on the HOST while the parent runs sandboxed, which
     * is the divergence the composition root's refusal exists to prevent. Absent ⇒ no sandbox, and
     * the child's tools act on its own confined root.
     */
    readonly sandboxClient?: TProjectedSandboxClient;
  }): IToolWithEventService[];

  /**
   * The product's provider registry. Carried as definitions rather than a constructed provider
   * because `createProvider` is code — the child builds its own provider from the serialized profile
   * against THIS registry, so a custom provider type resolves instead of throwing `Unknown provider`.
   */
  readonly providerDefinitions: readonly IProviderDefinition[];

  /**
   * How the child rebuilds a SANDBOX that the parent is running in (ARCH-033).
   *
   * The same shape as `providerDefinitions`, and for the same reason. A live `ISandboxClient` is an
   * open session against a remote machine; it cannot cross a process boundary. What CAN cross is the
   * pair (which client type, which snapshot) — `ISandboxClient.snapshot()` returns a
   * provider-owned reference and `restore(id)` hydrates a fresh client from it, and a reference is
   * just a string.
   *
   * So the composition root registers the constructor by type name, exactly as it registers provider
   * definitions, and the recipe carries `{ type, snapshotId }`. The child looks the type up here and
   * restores. Neither half works alone: a snapshot with no registry is a reference nothing can open,
   * and a registry with no snapshot rebuilds an EMPTY sandbox, which is worse than refusing because
   * the child would look sandboxed while sharing none of the parent's state.
   *
   * Absent ⇒ the product composes no sandbox, and `assertChildProcessSubagentsCanReproduce` in the
   * composition root refuses to start a sandboxed parent that cannot project. That refusal remains
   * the correct behaviour for a product that has not registered a factory; this seam is what lets one
   * stop refusing.
   */
  readonly sandboxFactories?: Readonly<Record<string, TSandboxClientFactory>>;
}

/**
 * Rebuilds a sandbox client of ONE type from a snapshot reference the parent produced.
 *
 * Deliberately not `() => ISandboxClient`: a factory that cannot receive the reference can only make
 * an empty sandbox, which is the failure mode this seam exists to avoid.
 */
export type TSandboxClientFactory = (snapshotId: string) => Promise<TProjectedSandboxClient>;

/**
 * What the factory hands back, expressed STRUCTURALLY rather than as `ISandboxClient`.
 *
 * This package is the neutral runner: it depends on `agent-core`, `agent-executor`,
 * `agent-framework`, `agent-interface-transport` and `agent-process` — deliberately not on
 * `agent-tools`, where `ISandboxClient` lives. Importing that type to describe a value this package
 * only ever passes through would add a dependency edge for a pass-through, which is the shape
 * ARCH-021 removed from here on the provider axis.
 *
 * So the seam names the minimum it needs to be honest about — the object is opaque to the runner and
 * meaningful only to the composition root that registered the factory and the tools that receive it.
 */
export type TProjectedSandboxClient = object;

/**
 * The serializable half — what the parent puts in the recipe.
 *
 * Both fields are required. `type` selects the factory; `snapshotId` is what the parent's
 * `snapshot()` returned. Carrying one without the other is the empty-sandbox failure above.
 */
export interface ISandboxProjection {
  readonly type: string;
  readonly snapshotId: string;
}

/**
 * Resolve a projection against the composition's registry, or explain precisely why it cannot be.
 *
 * Returns the client rather than throwing on absence, because the CALLER decides what an
 * unprojectable sandbox means: the composition root refuses to start, while a child that reaches
 * this with no projection simply has no sandbox and runs host tools at its own confined root.
 */
export async function restoreProjectedSandbox(
  projection: ISandboxProjection | undefined,
  factories: Readonly<Record<string, TSandboxClientFactory>> | undefined,
): Promise<TProjectedSandboxClient | undefined> {
  if (projection === undefined) return undefined;
  const factory = factories?.[projection.type];
  if (factory === undefined) {
    // Fail loudly rather than silently running unsandboxed. A child that was TOLD to be sandboxed and
    // quietly was not is ARCH-010's shape — the measured breach there was a subagent reading outside
    // its root — so an unregistered type must stop the job, not degrade it.
    throw new Error(
      `subagent worker: sandbox type "${projection.type}" is not registered in the worker composition. ` +
        `The parent is sandboxed and passed a snapshot reference, but this child cannot construct that ` +
        `client type. Register it in ISubagentWorkerComposition.sandboxFactories at the composition ` +
        `root — the same place providerDefinitions is registered, and for the same reason.`,
    );
  }
  return factory(projection.snapshotId);
}
