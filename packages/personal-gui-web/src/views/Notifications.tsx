import { useEffect, useId, useState } from 'react';

import { Button, errorText, inputClass } from './ui.js';

import type { IDeliverySettingsView, IDeliveryStatusView, IPersonalApi } from '../api.js';

interface IForm {
  /** What the person typed, so a blank or a half-typed number is sent as it is and refused by the agent. */
  readonly limit: string;
  readonly quiet: IDeliverySettingsView['quietHours'];
  readonly digest: IDeliverySettingsView['digest'];
}

const formOf = (settings: IDeliverySettingsView): IForm => ({
  limit: String(settings.dailyLimit),
  quiet: settings.quietHours,
  digest: settings.digest,
});

/**
 * What reaches the person beyond the feed: how many questions may be pushed to them in a day, quiet
 * hours, and a daily digest. The agent only suggests how urgent a question is; these limits are the
 * person's own and decide. What the limits hold back is never lost, it waits in the feed.
 */
export function NotificationsSection({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const ids = useId();
  const [status, setStatus] = useState<IDeliveryStatusView | undefined>(undefined);
  const [form, setForm] = useState<IForm | undefined>(undefined);
  const [message, setMessage] = useState<{ text: string; error: boolean } | undefined>(undefined);
  useEffect(() => {
    api.delivery().then(
      (loaded) => {
        setStatus(loaded);
        setForm(formOf(loaded.settings));
      },
      (caught: unknown) => setMessage({ text: errorText(caught), error: true }),
    );
  }, [api]);
  if (status === undefined || form === undefined)
    return (
      <section aria-label="Notifications" className="flex flex-col gap-1 text-[13px]">
        <h2 className="text-[15px] font-semibold">Notifications</h2>
        <p role="status" className={message?.error ? 'text-destructive' : 'text-muted-foreground'}>
          {message === undefined ? 'Loading…' : message.text}
        </p>
      </section>
    );
  const edit = (change: Partial<IForm>): void => {
    setMessage(undefined);
    setForm({ ...form, ...change });
  };
  return (
    <form
      aria-label="Notifications"
      className="flex flex-col gap-3"
      // The agent judges what may be saved and says so in the status line; the browser's own
      // bubble would be a second voice that blocks the request before the agent sees it.
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const saved = await api.saveDelivery({
            dailyLimit: form.limit.trim() === '' ? Number.NaN : Number(form.limit),
            quietHours: form.quiet,
            digest: form.digest,
          });
          setStatus(saved);
          setForm(formOf(saved.settings));
          setMessage({ text: 'Saved.', error: false });
        } catch (caught) {
          setMessage({ text: errorText(caught), error: true });
        }
      }}
    >
      <h2 className="text-[15px] font-semibold">Notifications</h2>
      <p className="text-[13px] text-muted-foreground">
        Your agent suggests how urgent a question is; these limits decide what reaches you.
      </p>
      <div className="flex flex-col gap-1 text-[13px]">
        <label htmlFor={`${ids}-limit`}>Daily limit</label>
        <input
          id={`${ids}-limit`}
          type="number"
          min={0}
          max={20}
          step={1}
          className={inputClass}
          value={form.limit}
          aria-describedby={`${ids}-limit-hint`}
          onChange={(event) => edit({ limit: event.target.value })}
        />
        <p id={`${ids}-limit-hint`} className="text-[12.5px] text-muted-foreground">
          How many questions may be pushed to you straight away each day, from 0 to 20. With 0 none
          is.
        </p>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={form.quiet.enabled}
          onChange={(event) => edit({ quiet: { ...form.quiet, enabled: event.target.checked } })}
        />
        Quiet hours
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[13px]">
          Quiet hours start
          <input
            type="time"
            className={inputClass}
            value={form.quiet.from}
            onChange={(event) => edit({ quiet: { ...form.quiet, from: event.target.value } })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Quiet hours end
          <input
            type="time"
            className={inputClass}
            value={form.quiet.to}
            onChange={(event) => edit({ quiet: { ...form.quiet, to: event.target.value } })}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={form.digest.enabled}
          onChange={(event) => edit({ digest: { ...form.digest, enabled: event.target.checked } })}
        />
        Daily digest
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        Digest time
        <input
          type="time"
          className={inputClass}
          value={form.digest.at}
          onChange={(event) => edit({ digest: { ...form.digest, at: event.target.value } })}
        />
      </label>
      <p className="text-[12.5px] text-muted-foreground">
        Times are in the local time of the machine your agent runs on. Nothing is pushed during
        quiet hours, and the digest waits for them to end. A question that is not pushed stays in
        your Feed.
      </p>
      <p className="text-[12.5px] text-muted-foreground">
        Today {status.today.sent} of {status.today.limit} pushed; {status.waitingInDigest}{' '}
        {status.waitingInDigest === 1 ? 'question waits' : 'questions wait'} for the digest.
      </p>
      <p
        role="status"
        className={`text-[13px] ${message?.error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {message?.text}
      </p>
      <div>
        <Button type="submit" tone="primary">
          Save notifications
        </Button>
      </div>
    </form>
  );
}
