import { useEffect, useId, useRef, useState } from 'react';

import { Button, errorText, inputClass } from './ui.js';

import type { IPersonalApi, IWebhookView, TWebhookFormat } from '../api.js';

/**
 * The address the agent sends each notification to, such as the topic address of a push-to-phone service
 * or an incoming address of a team chat. It may hold a secret, so the page sends it once, empties the
 * field and shows only its host from then on; the agent never sends it back. The agent judges whether
 * an address may be used and says why not in the status line.
 */
export function NotificationAddress({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const ids = useId();
  const [view, setView] = useState<IWebhookView | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<TWebhookFormat>('plain');
  // A format the person picked before the stored one arrived is theirs; the stored one does not undo it.
  const picked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | undefined>(undefined);
  useEffect(() => {
    api.webhook().then(
      (loaded) => {
        setView(loaded);
        if (!picked.current) setFormat(loaded.format);
      },
      (caught: unknown) => setMessage({ text: errorText(caught), error: true }),
    );
  }, [api]);
  const configured = view?.configured === true;
  // One action at a time: whichever it is, the form is held while it runs and the outcome is the status.
  const run = async (work: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      setMessage({ text: await work(), error: false });
    } catch (caught) {
      setMessage({ text: errorText(caught), error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      aria-label="Notification address"
      className="flex flex-col gap-3"
      // The agent judges what may be saved and says so in the status line; the browser's own bubble
      // would be a second voice that blocks the request before the agent sees it.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const saved = await api.saveWebhook({ url: url.trim(), format });
          setView(saved);
          setFormat(saved.format);
          // Kept by the agent now; the page holds none of it.
          setUrl('');
          return `Saved. Notifications go to ${saved.host ?? 'that address'}.`;
        });
      }}
    >
      <h2 className="text-[15px] font-semibold">Notification address</h2>
      <p className="text-[13px] text-muted-foreground">
        Your agent sends each notification to this address, for example the topic address of a
        push-to-phone service or an incoming address of a team chat. It is yours alone: it stays on
        this machine, the agent cannot read or change it, and this page shows only its host once it
        is saved.
      </p>
      <div className="flex flex-col gap-1 text-[13px]">
        <label htmlFor={`${ids}-url`}>Send notifications to this address</label>
        <input
          id={`${ids}-url`}
          type="url"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
          value={url}
          aria-describedby={`${ids}-url-hint`}
          onChange={(event) => {
            setMessage(undefined);
            setUrl(event.target.value);
          }}
        />
        <p id={`${ids}-url-hint`} className="text-[12.5px] text-muted-foreground">
          {configured
            ? `Notifications go to ${view?.host}. Type the address again to replace it or to change the format.`
            : 'No address is set. It must start with https://.'}
        </p>
      </div>
      <div className="flex flex-col gap-1 text-[13px]">
        <label htmlFor={`${ids}-format`}>Format</label>
        <select
          id={`${ids}-format`}
          className={inputClass}
          value={format}
          onChange={(event) => {
            picked.current = true;
            setFormat(event.target.value as TWebhookFormat);
          }}
        >
          <option value="plain">Plain text, with the title as a header</option>
          <option value="json">JSON with text and title</option>
        </select>
      </div>
      <p
        role="status"
        className={`text-[13px] ${message?.error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {message?.text}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" tone="primary" disabled={busy}>
          Save
        </Button>
        <Button
          disabled={busy || !configured}
          onClick={() =>
            void run(async () => {
              setView(await api.removeWebhook());
              setFormat('plain');
              return 'Removed. Notifications no longer go to an address.';
            })
          }
        >
          Remove
        </Button>
        <Button
          disabled={busy || !configured}
          onClick={() =>
            void run(async () => {
              await api.testWebhook();
              return 'Test sent. Check that it arrived.';
            })
          }
        >
          Send a test
        </Button>
      </div>
    </form>
  );
}
