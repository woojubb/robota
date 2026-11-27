import { useEffect, useId, useState } from 'react';

import { Button, errorText, inputClass } from './ui.js';

import type { IOfferPreferencesView, IPersonalApi, TOfferDelivery } from '../api.js';

const DELIVERY: readonly { readonly value: TOfferDelivery; readonly label: string }[] = [
  { value: 'feed', label: 'Feed only' },
  { value: 'notify', label: 'Notify me' },
  { value: 'digest', label: 'Daily digest only' },
];

interface IForm {
  readonly enabled: boolean;
  readonly delivery: TOfferDelivery;
  /** What the person typed for each list, so the agent judges it and says so when it refuses. */
  readonly topics: string;
  readonly mutedTopics: string;
  readonly mutedSources: string;
}

const formOf = (preferences: IOfferPreferencesView): IForm => ({
  enabled: preferences.enabled,
  delivery: preferences.delivery,
  topics: preferences.topics.join(', '),
  mutedTopics: preferences.mutedTopics.join(', '),
  mutedSources: preferences.mutedSources.join(', '),
});

const listOf = (text: string): string[] =>
  text
    .split(/[,\n]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/**
 * What the agent may suggest and how it is told: on or off, only in the Feed, also as a notification
 * or only in the daily digest, the topics wanted, and the topics and services muted. These are the
 * person's own words and decide; the agent only proposes. What is shown after a save is what the agent
 * answered, and a refusal leaves the form as it was typed.
 */
export function SuggestionsSection({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const ids = useId();
  const [form, setForm] = useState<IForm | undefined>(undefined);
  /** What the agent last said, which each save is measured against. */
  const [loaded, setLoaded] = useState<IOfferPreferencesView | undefined>(undefined);
  const [issue, setIssue] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<{ text: string; error: boolean } | undefined>(undefined);
  useEffect(() => {
    api.offerPreferences().then(
      (answer) => {
        setLoaded(answer.preferences);
        setForm(formOf(answer.preferences));
        setIssue(answer.issue);
      },
      (caught: unknown) => setMessage({ text: errorText(caught), error: true }),
    );
  }, [api]);
  if (form === undefined || loaded === undefined)
    return (
      <section aria-label="Suggestions" className="flex flex-col gap-1 text-[13px]">
        <h2 className="text-[15px] font-semibold">Suggestions</h2>
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
      aria-label="Suggestions"
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        // Only what the person changed is sent: a list is replaced whole, so sending one they did
        // not touch would undo a mute another page made since this form was read.
        const change: Partial<Record<keyof IForm, unknown>> = {};
        if (form.enabled !== loaded.enabled) change['enabled'] = form.enabled;
        if (form.delivery !== loaded.delivery) change['delivery'] = form.delivery;
        for (const key of ['topics', 'mutedTopics', 'mutedSources'] as const) {
          const typed = listOf(form[key]);
          if (typed.join('\n') !== loaded[key].join('\n')) change[key] = typed;
        }
        if (Object.keys(change).length === 0) {
          setMessage({ text: 'Nothing changed.', error: false });
          return;
        }
        try {
          const saved = await api.changeOfferPreferences(change as Partial<IOfferPreferencesView>);
          setLoaded(saved.preferences);
          setForm(formOf(saved.preferences));
          setIssue(saved.issue);
          setMessage({ text: 'Saved.', error: false });
        } catch (caught) {
          setMessage({ text: errorText(caught), error: true });
        }
      }}
    >
      <h2 className="text-[15px] font-semibold">Suggestions</h2>
      <p className="text-[13px] text-muted-foreground">
        Your agent notices tasks that may be worth doing. These choices decide whether it suggests
        them and how you are told; nothing starts until you start it.
      </p>
      {issue !== undefined && (
        <p role="alert" className="text-[13px] text-destructive">
          {issue}
        </p>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(event) => edit({ enabled: event.target.checked })}
        />
        Suggest tasks
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        How you are told
        <select
          className={inputClass}
          value={form.delivery}
          onChange={(event) => edit({ delivery: event.target.value as TOfferDelivery })}
        >
          {DELIVERY.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[12.5px] text-muted-foreground">
        A notification shares your daily limit and quiet hours with questions, and opens the Feed.
      </p>
      <div className="flex flex-col gap-1 text-[13px]">
        <label htmlFor={`${ids}-topics`}>Only these topics</label>
        <input
          id={`${ids}-topics`}
          className={inputClass}
          value={form.topics}
          aria-describedby={`${ids}-topics-hint`}
          onChange={(event) => edit({ topics: event.target.value })}
        />
        <p id={`${ids}-topics-hint`} className="text-[12.5px] text-muted-foreground">
          Task categories, separated by commas. Leave empty for every topic.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-[13px]">
        Muted topics
        <input
          className={inputClass}
          value={form.mutedTopics}
          onChange={(event) => edit({ mutedTopics: event.target.value })}
        />
      </label>
      <div className="flex flex-col gap-1 text-[13px]">
        <label htmlFor={`${ids}-sources`}>Muted sources</label>
        <input
          id={`${ids}-sources`}
          className={inputClass}
          value={form.mutedSources}
          aria-describedby={`${ids}-sources-hint`}
          onChange={(event) => edit({ mutedSources: event.target.value })}
        />
        <p id={`${ids}-sources-hint`} className="text-[12.5px] text-muted-foreground">
          Your library as library, or a connected service by its id. Mute from a suggestion's card
          to fill these in.
        </p>
      </div>
      <p
        role="status"
        className={`text-[13px] ${message?.error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {message?.text}
      </p>
      <div>
        <Button type="submit" tone="primary">
          Save suggestions
        </Button>
      </div>
    </form>
  );
}
