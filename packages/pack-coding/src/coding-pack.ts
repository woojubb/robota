import { createEditorCommandModule, createShellCommandModule } from '@robota-sdk/agent-command';
import { BUILT_IN_AGENTS } from '@robota-sdk/agent-framework';
import {
  createAskUserQuestionTool,
  createBashTool,
  createEditTool,
  createReadTool,
  createShellTool,
  createWriteTool,
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';

import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';

/**
 * Robota's built-in coding tools — the additive bundle mirror of `agent-framework`'s `createDefaultTools()`
 * ALWAYS-PRESENT set (shell/bash/read/write/edit/glob/grep/webFetch/webSearch/askUserQuestion). The
 * adapter-gated tools (`CodebaseRetrieval`, `Computer`) are deliberately excluded — a pack is a static
 * bundle and those tools only exist when their adapter/driver is injected at session-assembly time.
 *
 * Built from the published `@robota-sdk/agent-tools` factories directly (NOT re-implemented) so the pack
 * ships the real tool code objects. The pack test pins these to `createDefaultTools()` by name, so the pack
 * cannot silently drift from robota's actual default toolset.
 */
const CODING_TOOLS = [
  createShellTool(),
  createBashTool(),
  createReadTool(),
  createWriteTool(),
  createEditTool(),
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
  createAskUserQuestionTool(),
];

/**
 * `@robota-sdk/pack-coding` — robota's coding capability as a single {@link ICapabilityPack}, and the
 * additive-axis proof for ARCH-005: a pack can bundle robota's real coding capability (tools + command
 * modules + subagents) and be composed additively by `assembleProduct` on top of any product's base.
 *
 * - **tools** — the built-in coding tools (see `CODING_TOOLS`).
 * - **commandModules** — the coding command modules: `/shell` and `/editor` (the capability-level command
 *   modules, distinct from product-shell/settings/provider command infrastructure).
 * - **subagents** — robota's built-in coding subagents (`general-purpose`, `Explore`, `Plan`).
 *
 * This pack contributes only when a product profile lists it (opt-in); every contributed command/tool runs
 * only through the permission-gated runtime at call time.
 */
export const codingPack: ICapabilityPack = {
  id: 'coding',
  title: 'Coding',
  description: "Robota's built-in coding capability: file/shell tools, /shell + /editor commands, and the coding subagents.",
  tools: CODING_TOOLS,
  commandModules: [createShellCommandModule(), createEditorCommandModule()],
  subagents: BUILT_IN_AGENTS,
};
