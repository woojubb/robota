/**
 * The DEFAULT TOOL SET — a composition leaf.
 *
 * ARCH-035 moved this out of `@robota-sdk/agent-framework`. It is a defaults aggregator, and
 * `.agents/project-structure.md` classifies that family as a composition leaf "imported only at
 * composition roots (entry-point-only)" — not something a mid-layer assembly library owns, publishes
 * and self-consumes.
 *
 * The move is what carries the guarantee. `agent-subagent-runner` may depend on `agent-framework`
 * (it needs `createSubagentSession` and friends) but has no manifest edge to THIS package, so
 * `import { createDefaultTools } from '@robota-sdk/agent-tool-defaults'` does not resolve there at
 * all. A neutral runner composing the product's tool surface is now a compile error rather than a
 * scan finding — the same shape ARCH-021 achieved on the provider axis with
 * `@robota-sdk/agent-provider-defaults`.
 *
 * `DEFAULT_TOOL_DESCRIPTIONS` deliberately did NOT come along: its only consumer builds the system
 * prompt synchronously, and dragging it here would force either a static edge back into this leaf or
 * a second async hop through prompt building. It stays beside its consumer in `agent-framework`.
 */
import {
  createAskUserQuestionTool,
  createShellTool,
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createRetrievalTool,
  createComputerTool,
  createGlobTool,
  createGrepTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';

import type { FunctionTool } from '@robota-sdk/agent-core';
import type { ISandboxClient, IRetrievalAdapter, IComputerDriver } from '@robota-sdk/agent-tools';

/**
 * Create the default set of CLI tools.
 * Returns the standard tools.
 */
export interface ICreateDefaultToolsOptions {
  sandboxClient?: ISandboxClient;
  /**
   * The execution root every file tool is contained by. REQUIRED — ARCH-010.
   *
   * It was optional, and `child-process-subagent-worker.ts` called this factory with no argument at
   * all: `cwd` was `undefined`, the path guard was fail-open, and the subagent's `Read` returned
   * `/etc/hostname`. Requiring it means a construction site that forgets does not compile, which is
   * the only way a containment root stays a contract rather than a convention.
   */
  cwd: string;
  /** SELFHOST-003: when present, adds the adapter-gated `CodebaseRetrieval` tool (absent otherwise). */
  retrievalAdapter?: IRetrievalAdapter;
  /**
   * SELFHOST-010: when present, adds the adapter-gated `ComputerView` + `Computer` tools. Unlike the
   * shell tool's host `spawn` fallback, computer-use has NO host fallback — with no driver the tools are
   * simply ABSENT (there is no safe library-side "local" screen to fall back to).
   */
  computerDriver?: IComputerDriver;
}

/**
 * ARCH-035: returns `FunctionTool[]`, which is what every factory below actually returns.
 *
 * An earlier revision cast each one to `IToolWithEventService` because session assembly consumes that
 * interface. The cast was lossy in the direction that mattered: `ICapabilityPack.tools` is
 * `readonly FunctionTool[]`, so a pack CONSUMING this set could not assign it without a second cast
 * back — one erasure creating the need for another. `FunctionTool` satisfies `IToolWithEventService`,
 * so session assembly is unaffected and no cast is needed at either end.
 */
export function createDefaultTools(options: ICreateDefaultToolsOptions): FunctionTool[] {
  return [
    createShellTool(options),
    createBashTool(options),
    createReadTool(options),
    createWriteTool(options),
    createEditTool(options),
    // SEC-007: built per call, NOT the module-level singletons. A singleton is context-free by
    // construction, so registering one meant `Glob`/`Grep` could enumerate outside the session's
    // working directory while `Read`/`Write`/`Edit` were contained.
    createGlobTool(options),
    createGrepTool(options),
    webFetchTool,
    webSearchTool,
    createAskUserQuestionTool(),
    // Retrieval is adapter-gated: absent when no adapter is supplied (there is no host fallback).
    ...(options.retrievalAdapter
      ? [createRetrievalTool({ adapter: options.retrievalAdapter })]
      : []),
    // Computer-use is adapter-gated on the driver: absent when no driver is supplied. There is NO host
    // fallback (unlike the shell tool's host spawn) — no library-side "local" screen exists.
    ...(options.computerDriver ? createComputerTool({ driver: options.computerDriver }) : []),
  ];
}
