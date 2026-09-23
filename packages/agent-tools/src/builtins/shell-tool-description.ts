/**
 * The `Shell`/`Bash` tools' MODEL-FACING DESCRIPTION — the text that tells the model which shell it is
 * writing for and which sibling tool to prefer.
 *
 * Split out of `shell-tool.ts` (SEC-007) when documenting the containment decision pushed that file
 * past the anti-monolith limit. The split is by responsibility: this module owns a model-facing
 * CONTRACT (NEUT-002 — neutral, mechanism-only default text a consumer overrides at the composition
 * root), while `shell-tool.ts` owns process execution. They change for entirely different reasons.
 */

import type { IPlatformShell } from '@robota-sdk/agent-core';

/**
 * Dedicated-tool routing hints, keyed by the sibling tool's registered name. A hint is only
 * emitted when that sibling is actually part of the registered tool set (NEUT-002) — the
 * description must not route the model to tools that do not exist in a given assembly.
 */
const SIBLING_ROUTING_HINTS: ReadonlyArray<{ toolName: string; hint: string }> = [
  { toolName: 'Glob', hint: ' - File search: Use Glob (NOT find or ls)' },
  { toolName: 'Grep', hint: ' - Content search: Use Grep (NOT grep or rg)' },
  { toolName: 'Read', hint: ' - Read files: Use Read (NOT cat/head/tail)' },
  { toolName: 'Edit', hint: ' - Edit files: Use Edit (NOT sed/awk)' },
];

/**
 * Build the OS-aware tool description so the model writes syntax the host shell can run.
 * When `availableTools` is provided, sibling routing hints are restricted to tools in that set;
 * when omitted, the full default hint set is included (default assembly registers all siblings).
 */
export function buildShellToolDescription(
  shell: IPlatformShell,
  availableTools?: readonly string[],
): string {
  const hints = availableTools
    ? SIBLING_ROUTING_HINTS.filter((entry) => availableTools.includes(entry.toolName))
    : SIBLING_ROUTING_HINTS;

  const routingBlock =
    hints.length > 0
      ? [
          `IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands. Instead, use the appropriate dedicated tool:`,
          ...hints.map((entry) => entry.hint),
        ]
      : [];

  // TOOL-004: every sentence here describes a mechanism THIS tool enforces. Each command runs in
  // `workingDirectory` (default: the configured root) with no state carried between calls; there is
  // no `description` parameter; output truncation belongs to whichever layer applies it, not here.
  return [
    `Executes a command in the host shell and returns its output.`,
    ``,
    `Active shell: ${shell.label}. ${shell.syntaxHint}`,
    ``,
    `Each command runs in a fresh shell in workingDirectory (default: the configured working directory); no shell state carries over between calls.`,
    ``,
    ...routingBlock,
  ].join('\n');
}
