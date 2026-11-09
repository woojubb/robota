import type { IBackgroundTaskLogPage } from '@robota-sdk/agent-interface/execution';

function records(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/**
 * Why some records of the page are placeholders, one line per reason. "Unlock" is said only where an
 * unlock would read them, naming `/unlock` where the host registered it; a process with no keys at
 * all cannot, and the model reading this cannot unlock either — it can tell the person which command
 * to run.
 */
function unreadableHints(
  page: IBackgroundTaskLogPage,
  unlockCommand: string | undefined,
): string[] {
  const unreadable = page.unreadable;
  if (unreadable === undefined) return [];
  const hints: string[] = [];
  if (unreadable.locked > 0) {
    const them = unreadable.locked === 1 ? 'it' : 'them';
    const unlock = unlockCommand === undefined ? 'unlock' : `run \`${unlockCommand}\``;
    hints.push(
      `${records(unreadable.locked, 'sealed record')} on this page ${unreadable.locked === 1 ? 'is' : 'are'} locked; ${unlock} to read ${them}.`,
    );
  }
  if (unreadable.noKeys > 0) {
    const them = unreadable.noKeys === 1 ? 'it' : 'them';
    hints.push(
      `${records(unreadable.noKeys, 'sealed record')} on this page cannot be read: this process has no keys to open ${them}.`,
    );
  }
  if (unreadable.doesNotOpen > 0) {
    hints.push(
      unreadable.doesNotOpen === 1
        ? '1 record on this page does not open: it is damaged, or sealed with other keys or by a newer build.'
        : `${unreadable.doesNotOpen} records on this page do not open: they are damaged, or sealed with other keys or by a newer build.`,
    );
  }
  return hints;
}

/**
 * The text `/agent read` and `/background read` show for one page of a task's log: a plain page is its
 * lines, and a page with records it could not show says why after its lines. A
 * page with records always has lines — a record that cannot be shown is a fixed placeholder — so an
 * empty page has no log lines to show, whatever the reason.
 */
export function formatBackgroundLogPage(
  taskId: string,
  page: IBackgroundTaskLogPage,
  unlockCommand?: string,
): string {
  if (page.lines.length === 0) return `No log lines: ${taskId}`;
  const next = page.nextCursor ? [`Next offset: ${page.nextCursor.offset}`] : [];
  return [...page.lines, ...unreadableHints(page, unlockCommand), ...next].join('\n');
}
