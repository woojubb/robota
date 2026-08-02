/**
 * The allowlist of agent-tools builtins this node can run in-process, and how each is constructed.
 *
 * Split out of `index.ts` because WHICH tools exist and HOW each is bound to a containment root is a
 * registry concern, separate from executing a node.
 */

import {
  createBashTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createShellTool,
  createWriteTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';

import type { ITool } from '@robota-sdk/agent-core';

/**
 * Structural tool contract these agent-tools builtins satisfy (`FunctionTool` is owned by
 * `@robota-sdk/agent-core`, DATA-005 SSOT). Typed by the `ITool` interface rather than the concrete
 * class so it unifies across agent-core's dual ESM/CJS `.d.ts` (the class's private `eventService`
 * would otherwise read as a distinct nominal type). Only `.execute()` is used here.
 */
export type FunctionTool = ITool;

/**
 * A builtin factory, always given a containment root (SEC-007).
 *
 * `cwd` is REQUIRED here rather than optional, for the reason `pack-coding`'s `ICodingPackOptions`
 * makes it required: `checkPathWithinCwd` USED TO BE a no-op when `cwd` was `undefined`, so an optional
 * root was a guard that disarmed itself by omission. ARCH-010 made the guard refuse instead, and made
 * `cwd` required on the `agent-tools` factories too — so this is now the same rule stated at three
 * layers rather than the only thing enforcing it. The two builtins that reach the network
 * (`web-fetch`, `web-search`) have no filesystem path to contain and ignore it.
 */
export type ToolFactory = (options: { cwd: string }) => FunctionTool;

/** Static allowlist mapping `toolName` → the agent-tools builtin factory. */
export const TOOL_FACTORIES: Readonly<Record<string, ToolFactory>> = {
  read: (o) => createReadTool(o),
  write: (o) => createWriteTool(o),
  edit: (o) => createEditTool(o),
  // SEC-007: for these two the root is the DEFAULT WORKING DIRECTORY, not a boundary — deliberately,
  // and not to be "fixed" by reflex. A cwd guard on arbitrary command execution is undone by the
  // first `cd ..`, so it would constrain nothing while READING as a boundary in review. The real
  // boundary for command execution is the permission layer and the sandbox seam.
  shell: (o) => createShellTool(o),
  bash: (o) => createBashTool(o),
  // SEC-007: built per invocation and bound to the root, not the module-level `globTool`/`grepTool`
  // singletons this node used to hand back. A singleton is context-free by construction — there is
  // nothing for a containment root to bind to — which is why ARCH-010 deleted them outright.
  glob: (o) => createGlobTool(o),
  grep: (o) => createGrepTool(o),
  'web-fetch': () => webFetchTool,
  'web-search': () => webSearchTool,
};

/** The builtin tool names this node can run in-process. */
export const TOOL_NODE_ALLOWED_TOOLS: readonly string[] = Object.freeze(
  Object.keys(TOOL_FACTORIES),
);
