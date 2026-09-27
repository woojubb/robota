/**
 * `pnpm gui:dev` asks about an untrusted folder before it starts the sidecar (issue #3268), the way
 * the terminal UI does: the sidecar is headless and would refuse, but a person is at this terminal.
 */

/** Ask only where a grant could change the folder, and only when someone can answer. */
export function shouldAskToTrust(status, interactive) {
  return interactive && status !== undefined && status.askable === true;
}

/** The lines shown before the question: the folder and what trust would load, capped. */
export function trustQuestionLines(status, limit = 12) {
  const loads = status.loads ?? [];
  const shown = loads.slice(0, limit);
  return [
    `This folder is not trusted: ${status.workspace}`,
    "Trusting it lets the GUI's session load the project's own settings, hooks, plugins, skills and MCP servers:",
    ...shown,
    ...(loads.length > shown.length
      ? [`  … ${loads.length - shown.length} more — see robota trust status`]
      : []),
  ];
}

/** What the answer means: trust then start, start Restricted, or do not start. */
export function sidecarTrustDecision(answer) {
  const normalized = answer.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes') return 'trust';
  if (normalized === 'r' || normalized === 'restricted') return 'restricted';
  return 'quit';
}
