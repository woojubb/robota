'use client';

import { RefreshCw, Trash2 } from 'lucide-react';
import React, { useId, useState } from 'react';

import type { ISettingsPlugin, ISettingsSnapshot } from '@robota-sdk/agent-interface-session';

function PluginRow({
  plugin,
  canInstall,
  onToggleEnabled,
  onRequestUninstall,
}: {
  plugin: ISettingsPlugin;
  canInstall: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onRequestUninstall: () => void;
}): React.ReactElement {
  const labelId = useId();
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <span id={labelId} className="truncate text-[14px] font-medium text-foreground">
          {plugin.name}
        </span>
        {plugin.description ? (
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{plugin.description}</p>
        ) : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {canInstall ? (
          <button
            type="button"
            aria-label={`Uninstall ${plugin.name}`}
            onClick={onRequestUninstall}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-destructive"
          >
            <Trash2 size={15} strokeWidth={1.75} />
          </button>
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={plugin.enabled}
          aria-labelledby={labelId}
          onClick={() => onToggleEnabled(!plugin.enabled)}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            plugin.enabled ? 'bg-primary' : 'bg-raised'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              plugin.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </li>
  );
}

/**
 * The Plugins section (#3282 §4 part b-2): every installed plugin's name, description and enabled
 * state, an enable/disable switch, a section-level Reload, and — local surfaces only — install and
 * uninstall, since installing runs third-party code. `canInstall` (from the snapshot) mirrors the
 * refusal `/plugin install|uninstall` itself gives a remote device or an observer.
 */
export function SettingsPluginsSection({
  snapshot,
  onTogglePlugin,
  onReload,
  reloading,
  onRequestInstall,
  onRequestUninstall,
}: {
  snapshot: ISettingsSnapshot;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
  onReload: () => void;
  reloading: boolean;
  onRequestInstall: (pluginId: string) => void;
  onRequestUninstall: (plugin: ISettingsPlugin) => void;
}): React.ReactElement {
  const [installDraft, setInstallDraft] = useState('');
  const { plugins, canInstall } = snapshot.plugins;
  const installId = useId();

  function submitInstall(): void {
    const trimmed = installDraft.trim();
    if (trimmed.length === 0) return;
    onRequestInstall(trimmed);
    setInstallDraft('');
  }

  return (
    <section aria-labelledby="settings-plugins-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="settings-plugins-heading" className="text-[14px] font-medium text-foreground">
          Plugins
        </h3>
        <button
          type="button"
          onClick={onReload}
          disabled={reloading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[13px] text-foreground hover:bg-hover disabled:opacity-60"
        >
          <RefreshCw size={13} strokeWidth={1.75} className={reloading ? 'animate-spin' : ''} />
          Reload plugins
        </button>
      </div>
      {plugins.length === 0 ? (
        <p className="text-[13px] leading-snug text-muted-foreground">No plugins are installed.</p>
      ) : (
        <ul>
          {plugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              canInstall={canInstall}
              onToggleEnabled={(enabled) => onTogglePlugin(plugin.id, enabled)}
              onRequestUninstall={() => onRequestUninstall(plugin)}
            />
          ))}
        </ul>
      )}
      <div className="border-t border-border/60 pt-3">
        {canInstall ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={installId} className="text-[13px] font-medium text-foreground">
              Install a plugin
            </label>
            <div className="flex gap-2">
              <input
                id={installId}
                type="text"
                placeholder="name@marketplace"
                value={installDraft}
                onChange={(event) => setInstallDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitInstall();
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-raised px-2.5 py-1.5 text-[13.5px] text-foreground"
              />
              <button
                type="button"
                onClick={submitInstall}
                disabled={installDraft.trim().length === 0}
                className="flex-shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-foreground hover:bg-hover disabled:opacity-60"
              >
                Install
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] leading-snug text-muted-foreground">
            Installing and uninstalling plugins runs code on this computer, so it only works from the
            desktop app or the page opened here — not from a remote device.
          </p>
        )}
      </div>
    </section>
  );
}
