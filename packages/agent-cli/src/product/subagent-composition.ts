import {
  createProductSandbox,
  decodeOsSandboxSettings,
  liveSandboxSettings,
} from './execution-containment.js';

import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { findProviderDefinition } from '@robota-sdk/agent-core';
import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';
import { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import { createGoalStatusTool, sandboxApprovalFor } from '@robota-sdk/agent-framework';
import { OsSandboxClient } from '@robota-sdk/agent-tools';
import { CommandExecutor, HttpExecutor } from '@robota-sdk/agent-core/node';

import { createProductCapabilityPacks, packCommandModuleNames } from './product-profile.js';
import { createCliWorkspaceComposition } from '../startup/workspace-project-composition.js';
import { selectProductSubagentRunner } from './subagent-provider-reproduction.js';
import { resolveSelfForkWorkerEntry } from '../subagents/self-fork-worker-entry.js';
import { createGitWorktreeIsolationAdapter } from '../subagents/git-worktree-isolation-adapter.js';
import { resolveProductShellExecutable } from './shell.js';

import { childProductEnvironment } from './child-environment.js';
export { childProductEnvironment } from './child-environment.js';
import type { ICliRuntimeContext } from './runtime-context.js';
import type { IProviderReproduction } from './subagent-provider-reproduction.js';

import type { ISubagentWorkerComposition } from '@robota-sdk/agent-subagent-runner';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type { ICodingPackOptions } from '@robota-sdk/pack-coding';
import type { IOsSandboxSettings, ISandboxClient } from '@robota-sdk/agent-tools';
import type { IProviderDefinition, IToolWithEventService } from '@robota-sdk/agent-core';

type TProductPack = ReturnType<typeof createProductCapabilityPacks>[number];

/**
 * ARCH-021: the product's answer to "what does this product compose", for a child-process subagent.
 *
 * **The single source.** `bin.ts`'s worker branch and `cli.ts`'s parent composition both resolve
 * through here, so there is one expression of the product's tool surface rather than two. Two hand-written
 * expressions would be the same SSOT defect this item exists to remove, one layer over — and TC-05
 * turns any drift between them into a failing test rather than a third finding at this line.
 *
 * The child is the product's own binary (DIST-006), so it can build the product's surface locally from the
 * same packs the parent used; nothing live crosses the process boundary.
 */

/**
 * The parent-side pack context, as ONE named value.
 *
 * Both `createProductCapabilityPacks` and the runner selection read this, so the fail-closed guard below cannot
 * read a different value from the one the packs were actually built with.
 */
export interface IProductPackContext extends ICodingPackOptions {
  readonly cwd: string;
  /**
   * ARCH-033: which sandbox type `sandboxClient` is, so a child can rebuild one of the same kind.
   *
   * Names a key in the worker composition's `sandboxFactories`. Required alongside a sandbox client
   * for child-process subagents to be composable — without it the parent has a sandbox nothing on the
   * other side knows how to construct, and the guard below refuses rather than spawning children that
   * would silently run on the host.
   */
  readonly sandboxType?: string;
}

/** The pack-context `sandboxType` for the OS sandbox, which every process rebuilds from settings. */
export const OS_SANDBOX_TYPE = 'os';

/**
 * Capability a recipe cannot reproduce in the child, because it is a live, unrepeatable handle
 * rather than a pure function of (execution root, serialized payload, ambient durable state).
 *
 * Today that is exactly `sandboxClient`: it is consumed by `pack-coding`, and `E2BSandboxClient` /
 * `InMemorySandboxClient` are both exported from `agent-tools`'s barrel, so a consumer can compose a
 * sandboxed parent. Projecting it is #1784 (ARCH-033).
 */
export function nonReproducibleCapabilities(context: IProductPackContext): readonly string[] {
  // ARCH-033: a sandbox is non-reproducible only while nothing can REBUILD it in the child.
  //
  // The projection seam changed what this question means. A live client still cannot cross a process
  // boundary, but `(type, snapshotId)` can, and `ISubagentWorkerComposition.sandboxFactories` is
  // where a composition root registers the constructor for a type — the same shape, and the same
  // reason, as `providerDefinitions`. So a sandbox the root can project is reproducible, and one it
  // cannot is not.
  //
  // Both halves are required and this checks both: `snapshot()` is optional on `ISandboxClient`, so a
  // client that cannot produce a reference is unprojectable however many factories are registered,
  // and a registered factory is useless without a reference to hand it.
  if (!context.sandboxClient) return [];
  // The OS sandbox is a pure function of (execution root, settings): the child composes its own from
  // the parent's live settings, which cross as data, so no live handle has to.
  if (context.sandboxType === OS_SANDBOX_TYPE) return [];
  const projectable =
    typeof context.sandboxClient.snapshot === 'function' && context.sandboxType !== undefined;
  return projectable ? [] : ['sandboxClient'];
}

/**
 * Fail closed rather than open. A sandboxed parent with a host-tool child is ARCH-010's shape — the
 * measured breach there was a subagent reading outside its root — so a capability the child cannot
 * reproduce must stop the process, not be silently dropped.
 *
 * Stated precisely: this runs inside `createProductPackSet`, which `startCli` calls at composition
 * time, so the effect is that the product refuses to START rather than refusing an individual spawn. That
 * is the safe direction and the message says so.
 *
 * Two earlier wordings of this paragraph were wrong, which is why it now names its own call site: the
 * first described a spawn refusal that does not exist, and the second claimed to run inside `startCli`
 * while nothing called this function at all.
 *
 * The product supplies no sandbox client today, so this is correct-by-construction now and binds the
 * moment a sandbox input is added. That second reason is why it is worth having.
 */
export function assertChildProcessSubagentsCanReproduce(context: IProductPackContext): void {
  const missing = nonReproducibleCapabilities(context);
  if (missing.length === 0) return;
  throw new Error(
    `The CLI cannot start: this session composed ${missing.join(', ')}, which a child process cannot ` +
      'reproduce, so its subagents would run without it — a sandboxed parent with a host-tool child. ' +
      'This is refused at composition time rather than per spawn, so the failure is loud and early. ' +
      'Projecting live capability across the boundary is tracked as ARCH-033 (#1784).',
  );
}

/** the product's provider registry, in one place for both the parent and its child-process subagents. */
function productProviderDefinitions(): readonly IProviderDefinition[] {
  return createDefaultProviderDefinitions();
}

/**
 * The pack factory this composition derives from.
 *
 * Injectable for ONE reason, stated because it is not obvious: the product's own packs mirror
 * `createDefaultTools()` by name today — `pack-coding` is pinned to that set by its own test — so a
 * test comparing the two name sets passes whether the child composes from packs or from imported
 * defaults. That check cannot fail on the defect it names. Injecting a pack proves the derivation
 * instead of the coincidence.
 */
export type TProductPackFactory = (context: IProductPackContext) => readonly TProductPack[];

/**
 * The recipe handed to a child-process subagent worker. `createTools` takes the root per call so the
 * child binds its own execution root (ARCH-010) rather than inheriting the parent's.
 *
 * ARCH-109: `providerDefinitions` is a PARAMETER for the same reason `createPacks` is. The seam it
 * fills already existed — `ISubagentWorkerComposition.providerDefinitions` is documented as carrying
 * definitions rather than a constructed provider precisely so "a custom provider type resolves
 * instead of throwing `Unknown provider`" — but the product's own worker entry pinned it to the default
 * set, so the seam was present and unused. A product that composes its own providers supplies a
 * worker entry that builds THEM here, which is the only way the set crosses: rebuilt from code in
 * the child, never serialized.
 */
export function createProductSubagentComposition(
  productRuntime: ICliRuntimeContext,
  createPacks: TProductPackFactory = (context) => createProductCapabilityPacks(context, productRuntime),
  providerDefinitions: readonly IProviderDefinition[] = productProviderDefinitions(),
): ISubagentWorkerComposition {
  const shellExecutable = resolveProductShellExecutable(productRuntime.environment);
  return {
    createHookTypeExecutors: (context) => {
      const sandbox = context.sandboxClient as ISandboxClient | undefined;
      if (sandbox !== undefined && sandbox.filesystem !== 'shared') {
        // The sandbox port has no hook stdin/environment or HTTP capability. Never substitute host effects.
        return (['command', 'http'] as const).map((type) => ({
          type,
          execute: async () => ({
            outcome: 'error' as const,
            source: type,
            kind: 'spawn-failure' as const,
            reason: `Separate task worker ${type} hooks are unsupported; host execution is refused.`,
          }),
        }));
      }
      return [new CommandExecutor(shellExecutable), new HttpExecutor()];
    },
    createTools: (context: {
      readonly cwd: string;
      readonly sessionTiers?: { readonly includeGoalTool?: boolean };
      readonly sandboxClient?: object;
    }): IToolWithEventService[] => {
      // The worker hands back the sandbox `createSandbox` built (the product registers no snapshot type), so
      // the tools run under the instance the session's approval consults.
      const sandboxClient =
        (context.sandboxClient as ISandboxClient | undefined) ?? productSandboxAt(context.cwd, productRuntime);
      const tools = packTools(
        {
          cwd: context.cwd,
          shellExecutable,
          ...(sandboxClient !== undefined
            ? { sandboxClient, sandboxType: OS_SANDBOX_TYPE }
            : {}),
        },
        createPacks,
      );
      // ARCH-034: the goal tool is added by session assembly, not by any pack, so rebuilding the
      // pack set alone gave a child-process subagent a strictly smaller surface than an in-process
      // one. Choosing a runner is a packaging decision; this is what stops it being a capability one.
      return context.sessionTiers?.includeGoalTool === true
        ? [...tools, createGoalStatusTool() as IToolWithEventService]
        : tools;
    },
    providerDefinitions,
    // CLI-1994: a `/fork` job names a record to resume, and only the product knows where its records
    // live. This rebuilds the SAME composition the parent's `buildCommandSetup` builds for the
    // parent's cwd — not the execution root, which for a worktree-isolated child holds no records of
    // its own — so the child reads the store the parent just wrote the forked record into. Without
    // it every fork job dies in the worker with "this composition opens no session store".
    openSessionStore: (context: { readonly cwd: string }) =>
      createCliWorkspaceComposition({ cwd: context.cwd, productRuntime }).sessionStore,
    // The child confines its commands exactly as the parent does NOW: from the parent's live settings,
    // which `/sandbox` may have changed, and from its root's settings files only when none came. Its
    // session lets a confined command skip the prompt exactly as the parent's does.
    createSandbox: (context: {
      readonly cwd: string;
      readonly parentSettings?: Readonly<Record<string, unknown>>;
    }) => {
      const client = productSandboxAt(
        context.cwd,
        productRuntime,
        context.parentSettings === undefined
          ? undefined
          : decodeOsSandboxSettings(context.parentSettings),
      );
      if (client === undefined) return undefined;
      return {
        client,
        commandSandbox: sandboxApprovalFor(client),
        // A `/sandbox` change in the parent while this child runs: the same instance the tools and the
        // approval read takes it, so the next command follows it.
        applyParentSettings: (settings: Readonly<Record<string, unknown>>) =>
          client.configure(decodeOsSandboxSettings(settings)),
      };
    },
  };
}

/** the product's OS sandbox for one execution root, from the given settings or else that root's files. */
function productSandboxAt(cwd: string, productRuntime: ICliRuntimeContext, settings?: IOsSandboxSettings): OsSandboxClient | undefined {
  return createProductSandbox({
    cwd,
    productRuntime,
    settingsSources: createCliWorkspaceComposition({ cwd, productRuntime }).settingsSources,
    ...(settings !== undefined ? { settings } : {}),
  }).client;
}

/**
 * ARCH-006: the product's packs OWN its tool surface. Both processes read this, which is what makes
 * "dropping a pack drops its tools" true in the child as well as the parent.
 */
export function packTools(
  context: IProductPackContext,
  createPacks: TProductPackFactory,
): IToolWithEventService[] {
  return createPacks(context).flatMap((pack) => [...(pack.tools ?? [])]);
}

/**
 * the product's child-process subagent runner, and the guard that decides whether it may be selected at
 * all. They live together because they read the same pack context: separating them is what would let
 * a guard check one value while the packs were built from another.
 */
function createProductChildProcessSubagentRunner(options: {
  readonly productRuntime: ICliRuntimeContext;
  readonly packContext: IProductPackContext;
  readonly providerConfig: IProviderDefinitionConfig;
  readonly providerDefinitions: readonly IProviderDefinition[];
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
    parentSandboxSettings: parentSandboxSettingsOf(options.packContext),
    watchParentSandboxSettings: watchParentSandboxSettingsOf(options.packContext),
    workerEntry: options.workerEntry,
    providerConfig: options.providerConfig,
    providerDefinitions: options.providerDefinitions,
    logsDir: options.logsDir,
    inheritEnvironment: false,
    // The child gets only product bootstrap values and this provider's named connection inputs.
    env: productChildProviderEnvironment(options.productRuntime, options.providerConfig, options.providerDefinitions),
    expectedEnvironment: { ...options.productRuntime.environment },
    worktreeAdapter: options.worktreeAdapter,
  });
}

/** Project only the provider's named credential and destination/transport inputs into its worker. */
export function productChildProviderEnvironment(
  runtime: ICliRuntimeContext,
  providerConfig: IProviderDefinitionConfig,
  providerDefinitions: readonly IProviderDefinition[],
): NodeJS.ProcessEnv {
  const env = childProductEnvironment(runtime);
  const definition = findProviderDefinition(providerDefinitions, providerConfig.name);
  const names = new Set([
    ...TRANSPORT_ENVIRONMENT,
    ...(definition?.destinationEnvironment ?? []),
    ...(providerConfig.apiKeyEnv === undefined ? [] : [providerConfig.apiKeyEnv]),
  ]);
  for (const name of names) {
    const value = runtime.environment[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * What a child-process subagent is told about its parent's sandbox, read at each spawn: `/sandbox`
 * changes the parent's live client, not the settings files a child would otherwise read.
 */
export function parentSandboxSettingsOf(
  packContext: IProductPackContext,
): () => Readonly<Record<string, unknown>> | undefined {
  return () => {
    const settings = liveSandboxSettings(packContext.sandboxClient);
    return settings === undefined ? undefined : { ...settings };
  };
}

/**
 * How a running child-process subagent learns of a `/sandbox` change: the parent's live client tells
 * each watcher, and the runner forwards it. A parent without an OS sandbox has nothing to tell.
 */
export function watchParentSandboxSettingsOf(
  packContext: IProductPackContext,
): (listener: (settings: Readonly<Record<string, unknown>>) => void) => () => void {
  const client = packContext.sandboxClient;
  return (listener) =>
    client instanceof OsSandboxClient
      ? client.watchSettings((settings) => listener({ ...settings }))
      : () => undefined;
}

/**
 * the product's pack context and the packs built from it, as ONE value.
 *
 * ARCH-021: the context must be a single named value that both the pack construction and the
 * child-process runner selection read. Built here rather than at the call site so the two do not
 * drift into reading different values.
 *
 * Stated precisely, because the earlier wording overclaimed: `createProductChildProcessSubagentRunner`
 * takes a free-standing context, so a future call site COULD hand it one the packs were not built
 * from. Today there is exactly one construction site and one consumer; that is convention, not
 * construction. Tightening it means passing this whole result rather than a bare context.
 */
export function createProductPackSet(
  cwd: string,
  productRuntime: ICliRuntimeContext,
  capabilities: Omit<IProductPackContext, 'cwd'> = {},
): {
  readonly packContext: IProductPackContext;
  readonly packs: readonly TProductPack[];
  readonly packCommandModules: readonly string[];
} {
  // ARCH-033: the capabilities are a PARAMETER, not a hard-coded `{ cwd }`.
  //
  // This is why the guard below was inert. The signature took only `cwd`, so `packContext` could
  // never carry a `sandboxClient` and `nonReproducibleCapabilities()` returned `[]` by construction —
  // not because the product supplies no sandbox, but because this function had no way to receive one. A
  // guard whose input cannot vary is a guard that cannot fire, and the unit tests missed it because
  // they built the context themselves and called the guard directly.
  //
  // `the product` still passes nothing today, so its behaviour is unchanged. What changed is that the
  // guard is now reachable: a composition root that DOES supply a sandbox gets the refusal instead of
  // silently spawning children that cannot reproduce it.
  const packContext: IProductPackContext = { cwd, ...capabilities };
  // ARCH-033: the fail-closed guard runs HERE, on the same context the packs are built from.
  //
  // It was previously exported, unit-tested, and called by nothing — a fail-closed guard that never
  // runs is not fail-closed, it is decoration. Its own docblock claimed "this runs at composition
  // time inside `startCli`", which was false: `cli.ts` imports `createProductPackSet` and
  // `createProductChildProcessSubagentRunner` from this module and never the guard. Wiring it into the
  // one function the real path already calls is what makes the claim true, and puts the check on the
  // exact value the packs were composed with rather than on a re-derived one.
  assertChildProcessSubagentsCanReproduce(packContext);
  // ARCH-006: scoped to the cwd they are built with.
  const packs = createProductCapabilityPacks(packContext, productRuntime);
  return { packContext, packs, packCommandModules: packCommandModuleNames(packs) };
}

/**
 * ARCH-109: the product's subagent runner, wired.
 *
 * The three fixed inputs below — the log directory, the self-fork entry, and the worktree adapter —
 * are the product's own answers and have no reason to be spelled at the call site. Bringing them here is
 * also what let the selection be added at all: `cli.ts` is a file the size floor has already frozen
 * as debt, where the rule is "split instead of extending", so the change had to take more out of it
 * than it put in.
 */
export function createProductSubagentRunnerFactory(options: {
  readonly productRuntime: ICliRuntimeContext;
  readonly packContext: IProductPackContext;
  readonly providerConfig: IProviderDefinitionConfig;
  /** The registry the parent's provider came from: the child is checked against what it declares. */
  readonly providerDefinitions: readonly IProviderDefinition[];
  readonly reproduction: IProviderReproduction;
  readonly notice: (message: string) => void;
}): TSubagentRunnerFactory {
  const credentialReference = options.providerConfig.apiKeyEnv;
  const definition = findProviderDefinition(options.providerDefinitions, options.providerConfig.name);
  const connectionNames = new Set([
    ...TRANSPORT_ENVIRONMENT,
    ...(definition?.destinationEnvironment ?? []),
  ]);
  if (credentialReference !== undefined) connectionNames.delete(credentialReference);
  const connectionEnvironmentDiffers = [...connectionNames].some(
    (name) => (options.productRuntime.environment[name] ?? '') !== (process.env[name] ?? ''),
  );
  return selectProductSubagentRunner({
    reproduction: {
      ...options.reproduction,
      literalCredential: options.providerConfig.apiKey !== undefined && credentialReference === undefined,
      connectionEnvironmentDiffers,
    },
    notice: options.notice,
    buildChildProcess: () =>
      createProductChildProcessSubagentRunner({
        productRuntime: options.productRuntime,
        packContext: options.packContext,
        providerConfig: options.providerConfig,
        providerDefinitions: options.providerDefinitions,
        logsDir: options.productRuntime.config.storage.logRoot,
        workerEntry: resolveSelfForkWorkerEntry(),
        worktreeAdapter: createGitWorktreeIsolationAdapter({ worktreeDir: options.productRuntime.layout.projectWorktreesDirectory, branchPrefix: options.productRuntime.config.identity.id, environment: options.productRuntime.environment }),
      }),
  });
}
