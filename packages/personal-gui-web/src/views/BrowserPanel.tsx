import { useCallback, useEffect, useState } from 'react';

import { Button } from './ui.js';

import type { IBrowserScreenshotView, IBrowserWatchView, IPersonalApi } from '../api.js';

/** How often an open panel looks again while the agent works. */
const REFRESH_MS = 2000;

/**
 * The agent's own browser, as the person watching it sees it: the page it is on, a picture of that
 * page, what it did there, and what it is waiting to send. Stop ends the agent's work in progress (the
 * chat's turn here; the host ends goal runs and messenger turns) and closes its pages. Approving a held submission stays where the agent asks for it, in the chat or the feed.
 */
export function BrowserPanel({
  api,
  onStop,
  onClose,
}: {
  readonly api: IPersonalApi;
  /** Ends the agent's current turn; the panel also closes the agent's pages. */
  readonly onStop: () => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [watch, setWatch] = useState<IBrowserWatchView | undefined>(undefined);
  const [shot, setShot] = useState<IBrowserScreenshotView | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextWatch, nextShot] = await Promise.all([api.browser(), api.browserScreenshot()]);
      setWatch(nextWatch);
      setShot(nextShot);
    } catch {
      // The next refresh tries again; the panel keeps what it last saw.
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  const page = shot ?? watch?.page;
  return (
    <aside
      aria-label="Agent browser"
      className="absolute inset-0 z-20 flex h-full flex-col bg-background md:static md:w-[480px] md:flex-shrink-0 md:border-l md:border-border"
    >
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[14px] font-semibold">Agent browser</span>
        <span className="ml-auto flex gap-2">
          <Button
            tone="danger"
            disabled={page === undefined || page === null}
            onClick={async () => {
              onStop();
              await api.stopBrowser().catch(() => undefined);
              await refresh();
            }}
          >
            Stop
          </Button>
          <Button onClick={onClose}>Close</Button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {watch !== undefined && !watch.available && (
          <p className="text-[13px] text-muted-foreground">
            No browser is installed on this machine, so your agent reads pages without one.
          </p>
        )}
        {page === undefined || page === null ? (
          <p className="text-[13px] text-muted-foreground">
            Your agent has no page open. When it uses its browser, you can watch here.
          </p>
        ) : (
          <section aria-label="Current page" className="flex flex-col gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium">{page.title || page.url}</div>
              <div className="truncate text-[12.5px] text-muted-foreground">{page.url}</div>
            </div>
            {shot !== null && (
              <img
                src={shot.png}
                alt={`What your agent sees on ${shot.title || shot.url}`}
                className="w-full rounded-md border border-border"
              />
            )}
          </section>
        )}
        {watch !== undefined && watch.held.length > 0 && (
          <section aria-label="Waiting to send" className="mt-4">
            <h2 className="text-[13px] font-medium">Waiting for your approval</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Nothing below has been sent. Your agent asks you in the chat (or the feed, for a goal)
              before it sends any of it.
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {watch.held.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-md border border-border px-3 py-2 text-[13px]"
                >
                  <span className="font-medium">{entry.method}</span> {entry.url}
                  {entry.fields.length > 0 && (
                    <span className="text-muted-foreground">
                      {' '}
                      — fields {entry.fields.join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Browser activity" className="mt-4">
          <h2 className="text-[13px] font-medium">What your agent did</h2>
          {watch === undefined || watch.activity.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Nothing yet.</p>
          ) : (
            <ol className="mt-1 flex flex-col gap-1">
              {watch.activity.map((entry) => (
                <li key={`${entry.at}-${entry.summary}`} className="text-[13px]">
                  <span className="text-muted-foreground">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>{' '}
                  {entry.summary}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  );
}
