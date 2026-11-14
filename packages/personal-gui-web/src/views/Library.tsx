import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass } from './ui.js';

import type {
  IClaimView,
  ILintReport,
  ILogEntry,
  IPageSummary,
  IPageView,
  IPersonalApi,
} from '../api.js';

export const PAGE_KINDS = [
  'person',
  'place',
  'preference',
  'topic',
  'matter',
  'procedure',
  'persona',
  'other',
] as const;

/** Where a claim came from, in words a person reads: what they said, or what the agent read. */
export function originLabel(claim: IClaimView): string {
  const { origin, reference } = claim.source;
  if (origin === 'owner') return 'You said';
  if (origin === 'agent') return 'Your agent concluded';
  return `Read from ${origin}${reference === undefined ? '' : ` · ${reference}`}`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

type TTab = 'pages' | 'log' | 'check';

/**
 * The library: every page of the knowledge wiki the agent keeps about the person, readable with where
 * each fact came from, editable, and forgettable. Forgetting here is the same forget the agent uses:
 * the fact is removed from every page, link and log entry that held it.
 */
export function LibraryView({
  api,
  openPage,
  onOpenPage,
}: {
  readonly api: IPersonalApi;
  readonly openPage: string | undefined;
  readonly onOpenPage: (pageId: string | undefined) => void;
}): React.ReactElement {
  const [tab, setTab] = useState<TTab>('pages');
  const [pages, setPages] = useState<readonly IPageSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPages(await api.listPages());
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const tabs: readonly { id: TTab; label: string }[] = [
    { id: 'pages', label: 'Pages' },
    { id: 'log', label: 'Changes' },
    { id: 'check', label: 'Check' },
  ];
  return (
    <ViewFrame
      title="Library"
      actions={
        <>
          {tabs.map((item) => (
            <Button
              key={item.id}
              tone={tab === item.id ? 'primary' : 'default'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </>
      }
    >
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {tab === 'log' && <ChangeLog api={api} />}
      {tab === 'check' && (
        <WikiCheck
          api={api}
          onOpenPage={(pageId) => {
            setTab('pages');
            onOpenPage(pageId);
          }}
        />
      )}
      {tab === 'pages' && (
        <div className="flex h-full min-h-0">
          <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-border p-2">
            <div className="px-1 pb-2">
              <Button onClick={() => setCreating(true)}>New page</Button>
            </div>
            {pages !== undefined && pages.length === 0 && (
              <Notice>Nothing yet. Tell your agent about yourself in a chat, or add a page.</Notice>
            )}
            {PAGE_KINDS.map((kind) => {
              const ofKind = (pages ?? []).filter((page) => page.kind === kind);
              if (ofKind.length === 0) return null;
              return (
                <div key={kind} className="pb-2">
                  <div className="px-2 pb-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-subtle">
                    {kind}
                  </div>
                  {ofKind.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        onOpenPage(page.id);
                      }}
                      className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-hover ${openPage === page.id ? 'bg-hover' : ''}`}
                    >
                      {page.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {creating ? (
              <NewPage
                api={api}
                onCreated={async (pageId) => {
                  setCreating(false);
                  await reload();
                  onOpenPage(pageId);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : openPage === undefined ? (
              <Notice>Choose a page to see what your agent knows and where it learned it.</Notice>
            ) : (
              <PageDetail
                key={openPage}
                api={api}
                pageId={openPage}
                onChanged={reload}
                onGone={async () => {
                  onOpenPage(undefined);
                  await reload();
                }}
              />
            )}
          </div>
        </div>
      )}
    </ViewFrame>
  );
}

function NewPage({
  api,
  onCreated,
  onCancel,
}: {
  readonly api: IPersonalApi;
  readonly onCreated: (pageId: string) => Promise<void>;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('person');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      className="flex max-w-xl flex-col gap-3 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const created = await api.createPage({ title, kind, text });
          await onCreated(created.pageId);
        } catch (caught) {
          setError(errorText(caught));
        }
      }}
    >
      <h2 className="text-[15px] font-semibold">New page</h2>
      <label className="flex flex-col gap-1 text-[13px]">
        Title
        <input
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        Kind
        <select
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {PAGE_KINDS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        First fact
        <textarea
          className={inputClass}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          required
        />
      </label>
      {error !== undefined && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" tone="primary">
          Save page
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PageDetail({
  api,
  pageId,
  onChanged,
  onGone,
}: {
  readonly api: IPersonalApi;
  readonly pageId: string;
  readonly onChanged: () => Promise<void>;
  readonly onGone: () => Promise<void>;
}): React.ReactElement {
  const [page, setPage] = useState<IPageView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState('');

  const load = useCallback(async () => {
    try {
      setPage(await api.getPage(pageId));
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, pageId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    action: () => Promise<unknown>,
    after: () => Promise<void> = load,
  ): Promise<void> => {
    try {
      await action();
      await after();
      await onChanged();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  if (page === undefined)
    return error === undefined ? <Notice>Loading…</Notice> : <Notice tone="error">{error}</Notice>;
  const current = page.claims.filter((claim) => claim.validTo === undefined);
  const retired = page.claims.filter((claim) => claim.validTo !== undefined);
  const forgetsPage = (claim: IClaimView): boolean =>
    page.claims.length === 1 && page.claims[0]!.id === claim.id;
  return (
    <article className="flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex items-start gap-3">
        <div>
          <h2 className="text-[18px] font-semibold">{page.title}</h2>
          <p className="text-[13px] text-muted-foreground">
            {page.kind} · updated {day(page.updatedAt)}
          </p>
        </div>
        <div className="ml-auto">
          <Button
            tone="danger"
            onClick={() => {
              if (
                window.confirm(
                  `Forget everything on "${page.title}"? It is removed everywhere and cannot be restored.`,
                )
              ) {
                void run(() => api.forgetPage(page.id), onGone);
              }
            }}
          >
            Forget page
          </Button>
        </div>
      </header>
      {error !== undefined && <p className="text-[13px] text-destructive">{error}</p>}
      <ul className="flex flex-col gap-2">
        {current.map((claim) => (
          <li key={claim.id} className="rounded-lg border border-border p-3">
            {editing === claim.id ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api.addClaim(page.id, { text: draft, supersedes: claim.id });
                    setEditing(undefined);
                  });
                }}
              >
                <textarea
                  aria-label="Corrected fact"
                  className={inputClass}
                  rows={2}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  required
                />
                <div className="flex gap-2">
                  <Button type="submit" tone="primary">
                    Save correction
                  </Button>
                  <Button onClick={() => setEditing(undefined)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-[14px]">{claim.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
                  <span>{originLabel(claim)}</span>
                  <span>since {day(claim.validFrom)}</span>
                  {claim.source.sessionId !== undefined && (
                    <span>from chat {claim.source.sessionId.slice(0, 8)}</span>
                  )}
                  <span className="ml-auto flex gap-2">
                    <Button
                      onClick={() => {
                        setDraft(claim.text);
                        setEditing(claim.id);
                      }}
                    >
                      Correct
                    </Button>
                    <Button
                      tone="danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Forget this fact? It is removed everywhere and cannot be restored.',
                          )
                        ) {
                          void run(
                            () => api.forgetClaim(claim.id),
                            forgetsPage(claim) ? onGone : load,
                          );
                        }
                      }}
                    >
                      Forget
                    </Button>
                  </span>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api.addClaim(page.id, { text: adding });
            setAdding('');
          });
        }}
      >
        <input
          aria-label="New fact"
          placeholder="Add a fact"
          className={inputClass}
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          required
        />
        <Button type="submit">Add</Button>
      </form>
      {page.links.length > 0 && (
        <p className="text-[13px] text-muted-foreground">Related: {page.links.join(', ')}</p>
      )}
      {retired.length > 0 && (
        <details className="text-[13px] text-muted-foreground">
          <summary>No longer current ({retired.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {retired.map((claim) => (
              <li key={claim.id}>
                {claim.text} ({day(claim.validFrom)} – {day(claim.validTo!)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function ChangeLog({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const [entries, setEntries] = useState<readonly ILogEntry[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    api.log().then(setEntries, (caught: unknown) => setError(errorText(caught)));
  }, [api]);
  if (error !== undefined) return <Notice tone="error">{error}</Notice>;
  if (entries === undefined) return <Notice>Loading…</Notice>;
  if (entries.length === 0) return <Notice>No changes yet.</Notice>;
  return (
    <ul className="flex flex-col p-4 text-[13px]">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="border-b border-border py-1.5">
          <span className="text-muted-foreground">{entry.at.replace('T', ' ').slice(0, 16)}</span> ·{' '}
          {entry.action}
          {entry.pageId === undefined ? '' : ` ${entry.pageId}`}: {entry.summary}
        </li>
      ))}
    </ul>
  );
}

function WikiCheck({
  api,
  onOpenPage,
}: {
  readonly api: IPersonalApi;
  readonly onOpenPage: (pageId: string) => void;
}): React.ReactElement {
  const [report, setReport] = useState<ILintReport | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    api.lint().then(setReport, (caught: unknown) => setError(errorText(caught)));
  }, [api]);
  if (error !== undefined) return <Notice tone="error">{error}</Notice>;
  if (report === undefined) return <Notice>Checking…</Notice>;
  const items = [
    ...report.contradictions.map((item) => ({
      pageId: item.pageId,
      text: 'Facts that may contradict each other',
    })),
    ...report.stale.map((item) => ({
      pageId: item.pageId,
      text: 'A fact that may be out of date',
    })),
    ...report.orphans.map((pageId) => ({ pageId, text: 'A page nothing links to' })),
    ...report.missingLinks.map((item) => ({
      pageId: item.from,
      text: `Mentions ${item.to} without linking it`,
    })),
  ];
  if (items.length === 0)
    return <Notice>Nothing to fix: no contradictions, stale facts or loose pages.</Notice>;
  return (
    <ul className="flex flex-col gap-1 p-4 text-[14px]">
      {items.map((item, index) => (
        <li key={index}>
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => onOpenPage(item.pageId)}
          >
            {item.pageId}
          </button>{' '}
          — {item.text}
        </li>
      ))}
    </ul>
  );
}
