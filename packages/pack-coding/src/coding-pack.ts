import { createEditorCommandModule, createShellCommandModule } from '@robota-sdk/agent-command';
import { BUILT_IN_AGENTS } from '@robota-sdk/agent-framework';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';

import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

/**
 * The session context robota's coding tools are bound to.
 *
 * `cwd` is **required, not optional** — and that is the whole point of this factory. `agent-tools`'
 * `checkPathWithinCwd` USED TO BE a no-op when `cwd` was `undefined`, so file tools constructed with no
 * options carried a DISARMED working-directory guard: their `Read` returned `/etc/hostname`. Before
 * ARCH-006 that was inert, because the framework's own context-bound default tier always won a name
 * collision. Once a product could hand the entire tool surface to its packs (`defaultTools: []`), a
 * context-free pack became an unsandboxed `Read`/`Write`/`Edit`.
 *
 * ARCH-010 has since fixed the layer below: the guard refuses when no root is configured, and the tool
 * factories require `cwd` themselves. This requirement is therefore no longer load-bearing on its own —
 * it is the precedent the audit's fix followed, and it stays because the scoping decision should be
 * impossible to forget at every layer, not only the lowest one.
 */
export interface ICodingPackOptions {
  /**
   * Working-directory root the host file tools (`Read`/`Write`/`Edit`) are restricted to. Required: see
   * the interface note above. Pass the same value the session is assembled with.
   */
  cwd: string;
  /**
   * Optional provider sandbox client. When present the file/shell tools operate through the sandbox and
   * the host path guard does not apply — the sandbox is the isolation boundary.
   */
  sandboxClient?: ISandboxClient;
}

/**
 * Build robota's coding capability as a single {@link ICapabilityPack}, bound to one session context.
 *
 * This is the additive-axis proof for ARCH-005 and robota's first capability pack: a pack can bundle
 * robota's real coding capability (tools + command modules + subagents) and be composed additively by
 * `assembleProduct` on top of any product's base — and, since ARCH-006, can OWN the product's tool surface
 * outright when the profile suppresses the framework tier with `defaultTools: []`.
 *
 * - **tools** — `createDefaultTools()` from `@robota-sdk/agent-tool-defaults`, CONSUMED rather than
 *   mirrored (ARCH-035). That set is shell/bash/read/write/edit/glob/grep/webFetch/webSearch/
 *   askUserQuestion; the adapter-gated tools (`CodebaseRetrieval`, `Computer`) appear only when their
 *   adapter or driver is supplied, and this pack supplies neither. Until ARCH-035 the list was rebuilt
 *   here from the `@robota-sdk/agent-tools` factories and held to the defaults by a NAME-equality test
 *   — a pin that let ARCH-021's first TC-05 pass while being unable to fail, because comparing names
 *   cannot distinguish a pack-composed surface from an imported-default one when the two are pinned.
 *   The relationship is structural now, so there is no drift left to pin.
 * - **commandModules** — the coding command modules: `/shell` and `/editor` (the capability-level command
 *   modules, distinct from product-shell/settings/provider command infrastructure).
 * - **subagents** — robota's built-in coding subagents (`general-purpose`, `Explore`, `Plan`).
 *
 * This pack contributes only when a product profile lists it (opt-in); every contributed command/tool runs
 * only through the permission-gated runtime at call time.
 *
 * **Per-call instances, deliberately.** Each call builds fresh tool and command-module objects bound to the
 * supplied context, so two products assembled in one process get independently-scoped file tools. There is
 * no module-level singleton: a shared constant could only ever be context-free, which is exactly the hazard
 * this factory exists to remove.
 */
export function createCodingPack(options: ICodingPackOptions): ICapabilityPack {
  const toolOptions = {
    cwd: options.cwd,
    ...(options.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
  };

  return {
    id: 'coding',
    title: 'Coding',
    description:
      "Robota's built-in coding capability: file/shell tools, /shell + /editor commands, and the coding subagents.",
    // ARCH-035: the always-present default set, consumed from its owner rather than rebuilt here.
    //
    // This list used to be hand-maintained, identical to `createDefaultTools()`'s always-present
    // tier, and the two were held together by a test asserting their NAMES matched. That pin is what
    // let ARCH-021's first TC-05 pass without being able to fail: comparing tool names cannot tell a
    // pack-composed surface from an imported-default one when the pack is pinned to the defaults.
    // Consuming the set makes the relationship structural, so there is nothing left to drift.
    //
    // The adapter-gated tools stay out, as before: `createDefaultTools` adds `CodebaseRetrieval` only
    // when given a `retrievalAdapter` and the Computer tools only when given a `computerDriver`, and
    // this pack supplies neither. SEC-007 still holds — `cwd` is REQUIRED here, so the file-tool
    // guard cannot be disarmed by omission, and the leaf threads it into every tool it builds.
    tools: createDefaultTools(toolOptions),
    commandModules: [createShellCommandModule(), createEditorCommandModule()],
    subagents: BUILT_IN_AGENTS,
  };
}
