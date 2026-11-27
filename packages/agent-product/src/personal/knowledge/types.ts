/**
 * The knowledge wiki's data model and its store port.
 *
 * Knowledge is kept as linked pages of claims, not as a transcript: each claim names the turn it
 * came from, how far it is trusted, and the interval in which it held. A superseded claim is
 * retired with an end time instead of being overwritten, so the wiki can say what was true when.
 * The store port is all a host has to supply; a file store and a memory store are two adapters.
 */

export type TPageKind =
  'person' | 'place' | 'preference' | 'topic' | 'matter' | 'procedure' | 'persona' | 'other';

export const PAGE_KINDS: readonly TPageKind[] = [
  'person',
  'place',
  'preference',
  'topic',
  'matter',
  'procedure',
  'persona',
  'other',
];

/**
 * Where a claim came from. `owner` is what the person said or edited; every other origin is content
 * the agent read, which can be wrong or written to manipulate it, so it is recalled as data.
 */
export type TClaimOrigin = 'owner' | 'web' | 'mail' | 'peer' | 'tool' | 'agent';

export interface IClaimSource {
  /** The conversation the claim was learned in, when there was one. */
  readonly sessionId?: string;
  readonly origin: TClaimOrigin;
  /** A link or name for the source the agent read, for non-owner origins. */
  readonly reference?: string;
  /** When it was recorded (ISO 8601). */
  readonly at: string;
}

export interface IClaim {
  readonly id: string;
  readonly text: string;
  readonly source: IClaimSource;
  /** ISO 8601 time from which the claim held. */
  readonly validFrom: string;
  /** ISO 8601 time at which it stopped holding; absent while it is current. */
  readonly validTo?: string;
  /** The claim that replaced this one, when it was superseded. */
  readonly supersededBy?: string;
}

export interface IWikiPage {
  /** Lowercase slug; unique within one principal's wiki. */
  readonly id: string;
  readonly title: string;
  readonly kind: TPageKind;
  readonly claims: readonly IClaim[];
  /** Ids of pages this page links to. */
  readonly links: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TWikiLogAction =
  'remember' | 'supersede' | 'forget' | 'link' | 'edit' | 'delete-page' | 'lint';

export interface IWikiLogEntry {
  readonly at: string;
  readonly action: TWikiLogAction;
  readonly pageId?: string;
  readonly claimId?: string;
  /** The page a link entry points to. */
  readonly linkedTo?: string;
  /** A short human summary; never the text of a forgotten claim. */
  readonly summary: string;
}

/** What a host supplies for one principal's wiki. */
export interface IKnowledgeStore {
  listPages(): Promise<readonly IWikiPage[]>;
  getPage(id: string): Promise<IWikiPage | undefined>;
  putPage(page: IWikiPage): Promise<void>;
  deletePage(id: string): Promise<void>;
  appendLog(entry: IWikiLogEntry): Promise<void>;
  readLog(limit: number): Promise<readonly IWikiLogEntry[]>;
  /** Rewrite the log keeping only the entries `keep` accepts: how forget reaches the log. */
  rewriteLog(keep: (entry: IWikiLogEntry) => boolean): Promise<void>;
}

/** A piece of text a forget removed from the wiki: what a host must look for in its own copies. */
export interface IForgottenText {
  /** The statement of a removed claim, or the title of a page the forget deleted. */
  readonly text: string;
  /** A claim statement is a fact; a title is the name of a deleted page, mostly ordinary words. */
  readonly kind: 'claim' | 'title';
  /** The conversation a removed claim was learned in, when it recorded one. */
  readonly sessionId?: string;
}

/** What a host managed to do about the copies of forgotten text it keeps. */
export interface IForgetReachReport {
  /** Records rewritten so they no longer hold the text. */
  readonly cleaned: number;
  /** Records that will be cleaned later, for example when a running turn ends. */
  readonly pending: number;
  /** Records that hold the text and could not be reached (held by another writer, unreadable). */
  readonly notReached: number;
  /** Names of the conversations the removed claims were learned in, for the answer to the person. */
  readonly sources: readonly string[];
}

/**
 * What a host supplies so a forget reaches the copies the wiki does not own: the conversations the
 * wiki was filled from. The wiki calls it after its own pages and log are clean; it never holds the
 * conversations itself.
 */
export interface IForgetReach {
  reach(forgotten: readonly IForgottenText[]): Promise<IForgetReachReport>;
}
