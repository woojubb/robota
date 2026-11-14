import { useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass } from './ui.js';

import type { IPersonalApi, IProviderSettings, ISettings } from '../api.js';

/**
 * Settings the person changes from the page. The provider's key never passes through here: the page
 * names the environment variable that holds it, and the agent reads it from its own environment.
 */
export function SettingsView({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const [settings, setSettings] = useState<ISettings | undefined>(undefined);
  const [provider, setProvider] = useState<IProviderSettings>({ type: '', model: '' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  useEffect(() => {
    api.settings().then(
      (loaded) => {
        setSettings(loaded);
        setProvider(loaded.provider ?? { type: loaded.providerTypes[0] ?? '', model: '' });
      },
      (caught: unknown) => setError(errorText(caught)),
    );
  }, [api]);
  if (settings === undefined)
    return (
      <ViewFrame title="Settings">
        {error === undefined ? <Notice>Loading…</Notice> : <Notice tone="error">{error}</Notice>}
      </ViewFrame>
    );
  const field = (key: keyof IProviderSettings, value: string): void => {
    setSaved(undefined);
    setProvider((current) => {
      const next: Record<string, string> = { ...current, [key]: value };
      if (value === '' && (key === 'baseURL' || key === 'apiKeyEnv')) delete next[key];
      return next as unknown as IProviderSettings;
    });
  };
  return (
    <ViewFrame title="Settings">
      <div className="flex max-w-xl flex-col gap-6 p-4">
        <form
          aria-label="Model"
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const answer = await api.saveProvider(provider);
              setError(undefined);
              setSaved(
                answer.restartRequired
                  ? 'Saved. Restart the personal agent to use the new model.'
                  : 'Saved.',
              );
            } catch (caught) {
              setError(errorText(caught));
            }
          }}
        >
          <h2 className="text-[15px] font-semibold">Model</h2>
          <label className="flex flex-col gap-1 text-[13px]">
            Provider
            <select
              className={inputClass}
              value={provider.type}
              onChange={(event) => field('type', event.target.value)}
            >
              {settings.providerTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Model
            <input
              className={inputClass}
              value={provider.model}
              onChange={(event) => field('model', event.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Base URL (optional)
            <input
              className={inputClass}
              value={provider.baseURL ?? ''}
              onChange={(event) => field('baseURL', event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Environment variable holding the key (optional)
            <input
              className={inputClass}
              value={provider.apiKeyEnv ?? ''}
              onChange={(event) => field('apiKeyEnv', event.target.value)}
            />
          </label>
          {error !== undefined && <p className="text-[13px] text-destructive">{error}</p>}
          {saved !== undefined && <p className="text-[13px] text-muted-foreground">{saved}</p>}
          <div>
            <Button type="submit" tone="primary">
              Save model
            </Button>
          </div>
        </form>
        <section className="flex flex-col gap-1 text-[13px]">
          <h2 className="text-[15px] font-semibold">Browser</h2>
          <p className="text-muted-foreground">
            {settings.browser.available
              ? 'Your agent has its own browser. Anything it would submit to a site waits for your approval.'
              : 'No browser is installed on this machine, so your agent cannot open web pages.'}
          </p>
        </section>
        <section className="flex flex-col gap-1 text-[13px]">
          <h2 className="text-[15px] font-semibold">Where your data lives</h2>
          <p className="break-all text-muted-foreground">{settings.stateDir}</p>
          <p className="text-muted-foreground">
            Your library is plain Markdown in the wiki folder there; you can read or copy it without
            Robota.
          </p>
        </section>
      </div>
    </ViewFrame>
  );
}
