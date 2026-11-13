import { createGitCommandModule } from '../command/index.js';
import {
  createEditorCommandModule,
  createShellCommandModule,
} from '../command/node.js';
import { BUILT_IN_AGENTS } from '@robota-sdk/agent-framework';
import { createGitProcess } from '@robota-sdk/agent-framework/node';
import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';

import type { ICapabilityPack } from '../capability-pack/index.js';
import type { IEditorFileAccess, ISandboxClient } from '@robota-sdk/agent-tools';

/**
 * The session context agent's coding tools are bound to.
 *
 * `cwd` is **required, not optional** — and that is the whole point of this factory. File tools
 * built without a working directory have nothing to bind their working-directory guard to; a guard
 * that read a missing `cwd` as "no restriction" would let a context-free pack become an unsandboxed
 * `Read`/`Write`/`Edit`. That matters because a product can hand the entire tool surface to its
 * packs (`defaultTools: []`) instead of leaving it to the framework's context-bound default tier.
 *
 * The layer below refuses too: `agent-tools`' `checkPathWithinCwd` refuses when no root is
 * configured, and the tool factories require `cwd` themselves. This requirement is therefore not
 * load-bearing on its own — it stays because the scoping decision should be impossible to forget
 * at every layer, not only the lowest one.
 */
export interface ICodingPackOptions {
  /** Product-host shell choice for tools and the interactive /shell command. */
  shellExecutable?: string;
  /** HTTP identity selected by the product host. */
  httpUserAgent?: string;
  /** Product-owned prefix for the interactive editor's temporary directory. */
  editorTemporaryDirectoryPrefix?: string;
  /** Keep the command visible but refuse a host editor that would persist a sensitive draft. */
  editorUnavailableMessage?: string;
  /**
   * Working-directory root the host file tools (`Read`/`Write`/`Edit`) are restricted to. Required: see
   * the interface note above. Pass the same value the session is assembled with.
   */
  cwd: string;
  /**
   * Optional provider sandbox client. Shell commands always run through it; file tools do only when its
   * filesystem is `separate` (then the sandbox is the isolation boundary and the host-only search tools
   * are withheld). With a `shared` filesystem, file tools stay on the host under the path guard.
   */
  sandboxClient?: ISandboxClient;
  /**
   * An editor that has the workspace open, asked at each call: the host file tools read and write
   * through what it offers. Absent, or answering `undefined`, means the disk.
   */
  editorFiles?: () => IEditorFileAccess | undefined;
}

/**
 * Build agent's coding capability as a single {@link ICapabilityPack}, bound to one session context.
 *
 * This is the additive-axis proof and agent's first capability pack: a pack can bundle
 * agent's real coding capability (tools + command modules + subagents) and be composed additively by
 * `assembleProduct` on top of any product's base — and can OWN the product's tool surface
 * outright when the profile suppresses the framework tier with `defaultTools: []`.
 *
 * - **tools** — `createDefaultTools()` from `@robota-sdk/agent-tools/defaults`, CONSUMED rather than
 *   mirrored. That set is shell/bash/read/write/edit/glob/grep/webFetch/askUserQuestion,
 *   all tools that need no adapter, credential or external service. The list is not rebuilt here
 *   from the `@robota-sdk/agent-tools` factories and held to the defaults by a NAME-equality test
 *   — such a pin could not fail, because comparing names
 *   cannot distinguish a pack-composed surface from an imported-default one when the two are pinned.
 *   The relationship is structural, so there is no drift to pin.
 * - **commandModules** — the coding command modules: `/shell`, `/editor` and `/git` (the capability-level
 *   command modules, distinct from product-shell/settings/provider command infrastructure).
 * - **subagents** — agent's built-in coding subagents (`general-purpose`, `Explore`, `Plan`).
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
    httpUserAgent: options.httpUserAgent,
    ...(options.shellExecutable !== undefined ? { shellExecutable: options.shellExecutable } : {}),
    ...(options.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
    ...(options.editorFiles ? { editorFiles: options.editorFiles } : {}),
  };

  return {
    id: 'coding',
    title: 'Coding',
    description:
      'Built-in coding capability: file/shell tools, /shell + /editor + /git commands, and the coding subagents.',
    // The always-present default set, consumed from its owner rather than rebuilt here.
    //
    // This list is not hand-maintained to mirror `createDefaultTools()`'s always-present tier: a
    // test asserting that the NAMES matched could not fail, because comparing tool names cannot
    // tell a pack-composed surface from an imported-default one when the pack is pinned to the
    // defaults. Consuming the set makes the relationship structural, so there is nothing to drift.
    //
    // The default set holds no tool that needs an adapter, a credential or an external service, so
    // neither does this pack. The sandbox still holds — `cwd` is REQUIRED here, so the file-tool
    // guard cannot be disarmed by omission, and the leaf threads it into every tool it builds.
    tools: createDefaultTools(toolOptions),
    commandModules: [
      createShellCommandModule(options.shellExecutable),
      createEditorCommandModule(
        options.editorTemporaryDirectoryPrefix,
        options.editorUnavailableMessage,
      ),
      createGitCommandModule({ port: createGitProcess() }),
    ],
    subagents: BUILT_IN_AGENTS,
  };
}
