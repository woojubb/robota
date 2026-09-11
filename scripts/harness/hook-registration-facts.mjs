const HOOK_COMMAND_PATH_PATTERN = /\.claude\/hooks\/([A-Za-z0-9._-]+\.sh)/g;

/**
 * Collects the exact Claude hook command registrations declared in settings.
 *
 * Each registration retains its source location within the configuration shape
 * so separate registrations of the same script cannot be collapsed.
 *
 * @param {unknown} settings
 * @returns {Array<{
 *   event: string,
 *   matcher: string,
 *   commandPath: string,
 *   occurrence: number,
 *   sourceId: string,
 * }>}
 */
export function collectHookRegistrationFacts(settings) {
  if (typeof settings !== 'object' || settings === null) {
    return [];
  }

  const hooks = settings.hooks;
  if (typeof hooks !== 'object' || hooks === null) {
    return [];
  }

  const occurrences = new Map();
  const facts = [];

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      const matcher = typeof entry?.matcher === 'string' ? entry.matcher : '';
      const commands = Array.isArray(entry?.hooks) ? entry.hooks : [];

      for (const command of commands) {
        const commandText = typeof command?.command === 'string' ? command.command : '';
        const commandPaths = commandText.matchAll(HOOK_COMMAND_PATH_PATTERN);

        for (const match of commandPaths) {
          const commandPath = match[1];
          const identity = JSON.stringify([event, matcher, commandPath]);
          const occurrence = (occurrences.get(identity) ?? 0) + 1;
          occurrences.set(identity, occurrence);
          facts.push({ event, matcher, commandPath, occurrence, sourceId: commandPath });
        }
      }
    }
  }

  return facts;
}
