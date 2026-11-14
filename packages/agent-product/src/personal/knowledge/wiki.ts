/**
 * The knowledge wiki engine: what an agent may do to one principal's pages.
 *
 * - **Remember** files a claim on a page (creating the page when needed), refusing likely-sensitive
 *   text before anything is written, and retires a claim it supersedes rather than overwriting it.
 * - **Search** ranks pages by how many query terms their title and current claims contain, with recent
 *   pages first among equals: at a personal scale an index read beats an embedding store, and a
 *   ranking a person can follow beats one they cannot.
 * - **Forget** removes matching claims from every page that holds them and leaves only a content-free
 *   log line, so a forgotten claim is never recalled again.
 * - **Lint** reports contradictions, stale claims, orphan pages and unlinked mentions.
 */
import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

import { renderPageForModel } from './render.js';

import type { IClaim, IClaimSource, IKnowledgeStore, IWikiPage, TPageKind } from './types.js';

export class SensitiveContentRefusedError extends Error {
  constructor() {
    super('This looks like a secret or an identifier and is not kept in the wiki');
    this.name = 'SensitiveContentRefusedError';
  }
}

export interface IRememberInput {
  readonly pageTitle: string;
  readonly kind?: TPageKind;
  readonly claim: string;
  readonly source: Omit<IClaimSource, 'at'>;
  /** A current claim on the page this one replaces; it is retired, not deleted. */
  readonly supersedes?: string;
  /** Pages to link from this page. */
  readonly linkTo?: readonly string[];
}

export interface IRememberResult {
  readonly pageId: string;
  readonly claimId: string;
  readonly retired?: string;
}

export interface ISearchHit {
  readonly page: IWikiPage;
  readonly score: number;
}

export interface ILintReport {
  /** Pages holding more than one current claim marked as superseding the same earlier claim, or the same text twice. */
  readonly contradictions: readonly { pageId: string; claimIds: readonly string[] }[];
  /** Current claims older than the stale bound on pages of time-sensitive kinds. */
  readonly stale: readonly { pageId: string; claimId: string }[];
  /** Pages nothing links to (persona pages excepted). */
  readonly orphans: readonly string[];
  /** A page whose claims mention another page's title without linking to it. */
  readonly missingLinks: readonly { from: string; to: string }[];
}

export interface IKnowledgeWikiOptions {
  readonly store: IKnowledgeStore;
  readonly now?: () => Date;
  /** Claims on time-sensitive pages older than this are stale. Default 180 days. */
  readonly staleAfterMs?: number;
}

const TIME_SENSITIVE: ReadonlySet<TPageKind> = new Set(['matter', 'preference', 'place']);
const DEFAULT_STALE_MS = 180 * 24 * 60 * 60 * 1000;

export function pageIdFor(title: string): string {
  const slug = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const ascii = /^[a-z0-9-]+$/.test(slug) && slug !== '' ? slug : undefined;
  if (ascii !== undefined) return ascii;
  // A title in another script keeps a stable, filesystem-safe id.
  let hash = 0;
  for (const char of title) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return `page-${hash.toString(36)}`;
}

function terms(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);
}

export class KnowledgeWiki {
  private readonly store: IKnowledgeStore;
  private readonly now: () => Date;
  private readonly staleAfterMs: number;
  private sequence = 0;

  constructor(options: IKnowledgeWikiOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
  }

  private claimId(): string {
    this.sequence += 1;
    return `c${this.now().getTime().toString(36)}${this.sequence.toString(36)}`;
  }

  async remember(input: IRememberInput): Promise<IRememberResult> {
    if (containsSensitiveMemoryContent(input.claim) || containsSensitiveMemoryContent(input.pageTitle)) {
      throw new SensitiveContentRefusedError();
    }
    const at = this.now().toISOString();
    const pageId = pageIdFor(input.pageTitle);
    const existing = await this.store.getPage(pageId);
    const claimId = this.claimId();
    let retired: string | undefined;
    const claims = (existing?.claims ?? []).map((claim) => {
      if (input.supersedes !== undefined && claim.id === input.supersedes && claim.validTo === undefined) {
        retired = claim.id;
        return { ...claim, validTo: at, supersededBy: claimId };
      }
      return claim;
    });
    if (input.supersedes !== undefined && retired === undefined) {
      throw new Error(`No current claim ${input.supersedes} on page ${pageId}`);
    }
    const duplicate = claims.find((claim) => claim.validTo === undefined && claim.text.trim() === input.claim.trim());
    if (duplicate !== undefined && retired === undefined) return { pageId, claimId: duplicate.id };
    const claim: IClaim = { id: claimId, text: input.claim.trim(), source: { ...input.source, at }, validFrom: at };
    const links = [...new Set([...(existing?.links ?? []), ...(input.linkTo ?? []).map(pageIdFor)])].filter(
      (link) => link !== pageId,
    );
    await this.store.putPage({
      id: pageId,
      title: existing?.title ?? input.pageTitle.trim(),
      kind: existing?.kind ?? input.kind ?? 'other',
      claims: [...claims, claim],
      links,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    await this.store.appendLog({
      at,
      action: retired === undefined ? 'remember' : 'supersede',
      pageId,
      claimId,
      summary: retired === undefined ? 'claim added' : `claim ${retired} retired`,
    });
    return { pageId, claimId, ...(retired !== undefined && { retired }) };
  }

  async read(id: string): Promise<IWikiPage | undefined> {
    return this.store.getPage(id);
  }

  async list(): Promise<readonly IWikiPage[]> {
    const pages = await this.store.listPages();
    return [...pages].sort((a, b) => a.title.localeCompare(b.title));
  }

  async search(query: string, limit = 5): Promise<readonly ISearchHit[]> {
    const wanted = new Set(terms(query));
    if (wanted.size === 0) return [];
    const hits: ISearchHit[] = [];
    for (const page of await this.store.listPages()) {
      const haystack = new Set(
        terms([page.title, ...page.claims.filter((claim) => claim.validTo === undefined).map((claim) => claim.text)].join(' ')),
      );
      let score = 0;
      for (const term of wanted) if (haystack.has(term)) score += 1;
      if (score > 0) hits.push({ page, score });
    }
    return hits
      .sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt))
      .slice(0, limit);
  }

  /** The pages most relevant to a query, rendered for the model with provenance. */
  async recall(query: string, limit = 5): Promise<string> {
    const hits = await this.search(query, limit);
    if (hits.length === 0) return 'No wiki pages match.';
    return hits.map((hit) => renderPageForModel(hit.page)).join('\n\n');
  }

  /** Every page title and kind: what the model reads first, as an index. */
  async index(): Promise<string> {
    const pages = await this.list();
    if (pages.length === 0) return 'The wiki is empty.';
    return pages.map((page) => `- ${page.title} [${page.id}] (${page.kind}, ${page.claims.filter((c) => c.validTo === undefined).length} current claims)`).join('\n');
  }

  /**
   * Forget a claim by id, or every current or retired claim containing `text`. Returns how many
   * claims were removed. Pages left with no claims are deleted.
   */
  async forget(target: { claimId: string } | { text: string }): Promise<number> {
    const at = this.now().toISOString();
    let removed = 0;
    for (const page of await this.store.listPages()) {
      const keep = page.claims.filter((claim) =>
        'claimId' in target ? claim.id !== target.claimId : !claim.text.toLowerCase().includes(target.text.toLowerCase()),
      );
      const dropped = page.claims.length - keep.length;
      if (dropped === 0) continue;
      removed += dropped;
      if (keep.length === 0) {
        await this.store.deletePage(page.id);
      } else {
        await this.store.putPage({ ...page, claims: keep, updatedAt: at });
      }
      await this.store.appendLog({ at, action: 'forget', pageId: page.id, summary: `${dropped} claim(s) forgotten` });
    }
    return removed;
  }

  async link(from: string, to: string): Promise<void> {
    const page = await this.store.getPage(from);
    if (page === undefined) throw new Error(`No wiki page ${from}`);
    if (page.links.includes(to) || from === to) return;
    const at = this.now().toISOString();
    await this.store.putPage({ ...page, links: [...page.links, to], updatedAt: at });
    await this.store.appendLog({ at, action: 'link', pageId: from, summary: `linked to ${to}` });
  }

  async lint(): Promise<ILintReport> {
    const pages = await this.store.listPages();
    const now = this.now().getTime();
    const contradictions: { pageId: string; claimIds: string[] }[] = [];
    const stale: { pageId: string; claimId: string }[] = [];
    const missingLinks: { from: string; to: string }[] = [];
    const linked = new Set(pages.flatMap((page) => page.links));
    for (const page of pages) {
      const current = page.claims.filter((claim) => claim.validTo === undefined);
      const byText = new Map<string, string[]>();
      for (const claim of current) {
        const key = claim.text.trim().toLowerCase();
        byText.set(key, [...(byText.get(key) ?? []), claim.id]);
      }
      for (const ids of byText.values()) if (ids.length > 1) contradictions.push({ pageId: page.id, claimIds: ids });
      const negations = current.filter((claim) => /\b(no longer|not|never|stopped|doesn't|does not)\b/iu.test(claim.text));
      for (const negation of negations) {
        const negated = terms(negation.text);
        const conflict = current.find(
          (claim) =>
            claim.id !== negation.id &&
            !negations.includes(claim) &&
            terms(claim.text).filter((term) => negated.includes(term)).length >= Math.min(2, terms(claim.text).length),
        );
        if (conflict !== undefined) contradictions.push({ pageId: page.id, claimIds: [conflict.id, negation.id] });
      }
      if (TIME_SENSITIVE.has(page.kind)) {
        for (const claim of current) {
          if (now - Date.parse(claim.validFrom) > this.staleAfterMs) stale.push({ pageId: page.id, claimId: claim.id });
        }
      }
      const text = current.map((claim) => claim.text.toLowerCase()).join(' ');
      for (const other of pages) {
        if (other.id === page.id || page.links.includes(other.id)) continue;
        if (other.title.length > 2 && text.includes(other.title.toLowerCase())) missingLinks.push({ from: page.id, to: other.id });
      }
    }
    const orphans = pages.length > 1 ? pages.filter((page) => page.kind !== 'persona' && !linked.has(page.id)).map((page) => page.id) : [];
    const report = { contradictions, stale, orphans, missingLinks };
    await this.store.appendLog({
      at: this.now().toISOString(),
      action: 'lint',
      summary: `${contradictions.length} contradiction(s), ${stale.length} stale, ${orphans.length} orphan(s), ${missingLinks.length} missing link(s)`,
    });
    return report;
  }
}
