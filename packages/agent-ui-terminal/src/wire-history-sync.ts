/**
 * The host's history as a terminal attached over the wire knows it, read one page at a time.
 *
 * The transcript is committed to the terminal once and counted (Ink `<Static>`), so what this shows
 * must only ever grow at its end. Two rules keep it so:
 * - a history read is shown when its last page arrives, never half-read;
 * - a prompt's echo is held back while the host has entries this terminal has not read yet, since
 *   the echo would take the place one of them belongs in. It is shown once the read catches up,
 *   unless the host has recorded the prompt by then.
 */

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IWireHistoryEntry, TServerMessage } from '@robota-sdk/agent-transport/client';

type THistoryPage = Extract<TServerMessage, { type: 'history' }>;

export interface IWireHistorySyncOptions {
  /** Ask the host for the page from `fromIndex`; false when it could not be sent. */
  readonly request: (fromIndex: number) => boolean;
  /** Show the host's history as known, then the echoes of prompts the host has not recorded yet. */
  readonly show: (entries: readonly IHistoryEntry[], echoes: readonly IHistoryEntry[]) => void;
  /** A page's entries as the terminal holds them. */
  readonly revive: (entries: readonly IWireHistoryEntry[]) => IHistoryEntry[];
}

interface IHistoryRead {
  /** From the start of the history, replacing what is known; otherwise after what is known. */
  readonly reload: boolean;
  readonly entries: IHistoryEntry[];
  /** Where the next page must start. */
  next: number;
}

interface IPromptEcho {
  readonly entry: IHistoryEntry;
  readonly content: string;
  /** How many host entries were known when the prompt was echoed: the host records it after them. */
  readonly after: number;
  shown: boolean;
}

function isUserEntryWith(entry: IHistoryEntry, content: string): boolean {
  if (entry.category !== 'chat' || entry.type !== 'user') return false;
  const data = entry.data;
  return typeof data === 'object' && data !== null && 'content' in data && data.content === content;
}

export class WireHistorySync {
  private known: IHistoryEntry[] = [];
  private read: IHistoryRead | undefined;
  /** What to read once the current read ends; a reload covers a tail read. */
  private followUp: 'tail' | 'reload' | undefined;
  private echoes: IPromptEcho[] = [];

  constructor(private readonly options: IWireHistorySyncOptions) {}

  /** The host has entries this terminal has not read yet. */
  get behind(): boolean {
    return this.read !== undefined || this.followUp !== undefined;
  }

  /** The host added entries after the ones known: read from there. */
  readTail(): void {
    if (this.read !== undefined) {
      this.followUp ??= 'tail';
      return;
    }
    this.start(false);
  }

  /** The host's history may differ anywhere: read all of it again. */
  reload(): void {
    if (this.read !== undefined) {
      this.followUp = 'reload';
      return;
    }
    this.start(true);
  }

  /**
   * Read all of it again now, giving up on a read in flight: its reply may never come (frames were
   * lost). A reply that still comes is told apart by where it starts.
   */
  restart(): void {
    this.read = undefined;
    this.followUp = undefined;
    this.start(true);
  }

  /** Another session, or none: nothing known, echoed or being read belongs to what comes next. */
  reset(): void {
    this.known = [];
    this.read = undefined;
    this.followUp = undefined;
    this.echoes = [];
  }

  /**
   * One page from the host. Only the page the current read asked for is taken. Any page is the
   * host's history as of when it was sent, so one that answers a read given up on and happens to
   * start where this read needs is as good as its own answer.
   */
  onPage(page: THistoryPage): void {
    const read = this.read;
    if (read === undefined) return;
    if (page.startIndex !== read.next) {
      // The host holds fewer entries than this read counted on: its history is not the one known.
      if (page.total < read.next) this.restart();
      return;
    }
    read.entries.push(...this.options.revive(page.entries));
    read.next += page.entries.length;
    if (read.next < page.total && page.entries.length > 0) {
      if (!this.options.request(read.next)) this.read = undefined;
      return;
    }
    this.read = undefined;
    this.known = read.reload ? read.entries : [...this.known, ...read.entries];
    const followUp = this.followUp;
    this.followUp = undefined;
    if (followUp !== undefined) this.start(followUp === 'reload');
    this.show();
  }

  /** A prompt a turn started with, shown at once unless the host has entries not read yet. */
  echo(entry: IHistoryEntry, content: string): void {
    this.echoes.push({ entry, content, after: this.known.length, shown: false });
    this.show();
  }

  private start(reload: boolean): void {
    const from = reload ? 0 : this.known.length;
    this.read = { reload, entries: [], next: from };
    if (!this.options.request(from)) this.read = undefined;
  }

  private show(): void {
    this.echoes = this.unrecordedEchoes();
    if (!this.behind) for (const echo of this.echoes) echo.shown = true;
    this.options.show(
      this.known,
      this.echoes.filter((echo) => echo.shown).map((echo) => echo.entry),
    );
  }

  /** The echoes whose prompt the host has not recorded, as far as this terminal has read. */
  private unrecordedEchoes(): IPromptEcho[] {
    let searchFrom = 0;
    return this.echoes.filter((echo) => {
      const from = Math.max(searchFrom, echo.after);
      const index = this.known.findIndex(
        (entry, position) => position >= from && isUserEntryWith(entry, echo.content),
      );
      if (index === -1) return true;
      searchFrom = index + 1;
      return false;
    });
  }
}
