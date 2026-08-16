import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';
import { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';

import { createRobotaPacks, packCommandModuleNames } from './robota-profile.js';

import type { ISubagentWorkerComposition } from '@robota-sdk/agent-subagent-runner';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type { ICodingPackOptions } from '@robota-sdk/pack-coding';
import type { IProviderDefinition, IToolWithEventService } from '@robota-sdk/agent-core';

type TRobotaPack = ReturnType<typeof createRobotaPacks>[number];

/**
 * ARCH-021: robota's answer to "what does this product compose", for a child-process subagent.
 *
 * **The single source.** `bin.ts`'s worker branch and `cli.ts`'s parent composition both resolve
 * through here, so there is one expression of robota's tool surface rather than two. Two hand-written
 * expressions would be the same SSOT defect this item exists to remove, one layer over — and TC-05
 * turns any drift between them into a failing test rather than a third finding at this line.
 *
 * The child is robota's own binary (DIST-006), so it can build the product's surface locally from the
 * same packs the parent used; nothing live crosses the process boundary.
 */

/**
 * The parent-side pack context, as ONE named value.
 *
 * Both `createRobotaPacks` and the runner selection read this, so the fail-closed guard below cannot
 * read a different value from the one the packs were actually built with.
 */
export interface IRobotaPackContext extends ICodingPackOptions {
  readonly cwd: string;
}

/**
 * Capability a recipe cannot reproduce in the child, because it is a live, unrepeatable handle
 * rather than a pure function of (execution root, serialized payload, ambient durable state).
 *
 * Today that is exactly `sandboxClient`: it is consumed by `pack-coding`, and `E2BSandboxClient` /
 * `InMemorySandboxClient` are both exported from `agent-tools`'s barrel, so a consumer can compose a
 * sandboxed parent. Projecting it is #1784 (ARCH-033).
 */
export function nonReproducibleCapabilities(context: IRobotaPackContext): readonly string[] {
  return context.sandboxClient ? ['sandboxClient'] : [];
}

/**
 * Fail closed rather than open. A sandboxed parent with a host-tool child is ARCH-010's shape — the
 * measured breach there was a subagent reading outside its root — so a capability the child cannot
 * reproduce must stop the process, not be silently dropped.
 *
 * Stated precisely: this runs at composition time inside `startCli`, so the effect is that robota
 * refuses to START, not that an individual spawn is refused. That is the safe direction and the
 * message says so — an earlier wording described a spawn refusal that does not exist.
 *
 * Robota supplies no sandbox client today, so this is correct-by-construction now and binds the
 * moment a sandbox input is added. That second reason is why it is worth having.
 */
export function assertChildProcessSubagentsCanReproduce(context: IRobotaPackContext): void {
  const missing = nonReproducibleCapabilities(context);
  if (missing.length === 0) return;
  throw new Error(
    `robota cannot start: this session composed ${missing.join(', ')}, which a child process cannot ` +
      'reproduce, so its subagents would run without it — a sandboxed parent with a host-tool child. ' +
      'This is refused at composition time rather than per spawn, so the failure is loud and early. ' +
      'Projecting live capability across the boundary is tracked as ARCH-033 (#1784).',
  );
}

/** robota's provider registry, in one place for both the parent and its child-process subagents. */
function robotaProviderDefinitions(): readonly IProviderDefinition[] {
  return createDefaultProviderDefinitions();
}

/**
 * The pack factory this composition derives from.
 *
 * Injectable for ONE reason, stated because it is not obvious: robota's own packs mirror
 * `createDefaultTools()` by name today — `pack-coding` is pinned to that set by its own test — so a
 * test comparing the two name sets passes whether the child composes from packs or from imported
 * defaults. That check cannot fail on the defect it names. Injecting a pack proves the derivation
 * instead of the coincidence.
 */
export type TRobotaPackFactory = (context: IRobotaPackContext) => readonly TRobotaPack[];

/**
 * The recipe handed to a child-process subagent worker. `createTools` takes the root per call so the
 * child binds its own execution root (ARCH-010) rather than inheriting the parent's.
 */
export function createRobotaSubagentComposition(
  createPacks: TRobotaPackFactory = createRobotaPacks,
): ISubagentWorkerComposition {
  return {
    createTools: (context: { readonly cwd: string }): IToolWithEventService[] =>
      packTools({ cwd: context.cwd }, createPacks),
    providerDefinitions: robotaProviderDefinitions(),
  };
}

/**
 * ARCH-006: robota's packs OWN its tool surface. Both processes read this, which is what makes
 * "dropping a pack drops its tools" true in the child as well as the parent.
 */
export function packTools(
  context: IRobotaPackContext,
  createPacks: TRobotaPackFactory = createRobotaPacks,
): IToolWithEventService[] {
  return createPacks(context).flatMap((pack) => [...(pack.tools ?? [])]);
}

/**
 * robota's child-process subagent runner, and the guard that decides whether it may be selected at
 * all. They live together because they read the same pack context: separating them is what would let
 * a guard check one value while the packs were built from another.
 */
export function createRobotaChildProcessSubagentRunner(options: {
  readonly packContext: IRobotaPackContext;
  readonly providerConfig: IProviderDefinitionConfig;
  readonly logsDir: string;
  readonly workerEntry: Parameters<
    typeof createChildProcessSubagentRunnerFactory
  >[0]['workerEntry'];
  readonly worktreeAdapter: Parameters<
    typeof createChildProcessSubagentRunnerFactory
  >[0]['worktreeAdapter'];
}): TSubagentRunnerFactory {
  // ARCH-021: fail closed. A capability the child cannot reproduce must stop the spawn rather than
  // be silently dropped — a sandboxed parent with a host-tool child is ARCH-010's measured shape.
  assertChildProcessSubagentsCanReproduce(options.packContext);
  return createChildProcessSubagentRunnerFactory({
    workerEntry: options.workerEntry,
    providerConfig: options.providerConfig,
    logsDir: options.logsDir,
    worktreeAdapter: options.worktreeAdapter,
  });
}

/**
 * robota's pack context and the packs built from it, as ONE value.
 *
 * ARCH-021: the context must be a single named value that both the pack construction and the
 * child-process runner selection read. Built here rather than at the call site so the two do not
 * drift into reading different values.
 *
 * Stated precisely, because the earlier wording overclaimed: `createRobotaChildProcessSubagentRunner`
 * takes a free-standing context, so a future call site COULD hand it one the packs were not built
 * from. Today there is exactly one construction site and one consumer; that is convention, not
 * construction. Tightening it means passing this whole result rather than a bare context.
 */
export function createRobotaPackSet(cwd: string): {
  readonly packContext: IRobotaPackContext;
  readonly packs: readonly TRobotaPack[];
  readonly packCommandModules: readonly string[];
} {
  const packContext: IRobotaPackContext = { cwd };
  // ARCH-006: scoped to the cwd they are built with.
  const packs = createRobotaPacks(packContext);
  return { packContext, packs, packCommandModules: packCommandModuleNames(packs) };
}
