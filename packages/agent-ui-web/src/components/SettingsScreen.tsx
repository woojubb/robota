'use client';

import { ChevronLeft, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { ConfirmDialog, Dialog } from './Dialog.js';
import { SettingsGeneralSection } from './SettingsGeneralSection.js';
import { SettingsMcpSection } from './SettingsMcpSection.js';
import { describePermissionRuleRemoval, SettingsPermissionsSection } from './SettingsPermissionsSection.js';
import { SettingsPluginsSection } from './SettingsPluginsSection.js';

import type { IWsSessionState } from '../hooks/useSessionClient.js';
import type { ISettingsPermissionRule, ISettingsPlugin } from '@robota-sdk/agent-interface-session';

interface ISettingsSectionDefinition {
  id: string;
  label: string;
}

/**
 * The Settings screen's sections (#3282 §4). Adding a later section (Providers & Models, Advisor)
 * is one entry here plus one component in the switch below — nothing else in this file changes.
 */
const SECTIONS: readonly ISettingsSectionDefinition[] = [
  { id: 'general', label: 'General' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'plugins', label: 'Plugins' },
];

type TPendingSkipAllChecks = { kind: 'mode' } | { kind: 'preset'; presetId: string };
type TPendingPluginAction =
  | { kind: 'install'; pluginId: string }
  | { kind: 'uninstall'; plugin: ISettingsPlugin };

/**
 * A large modal sheet with a section sidebar on the left and content on the right (#3282 §4a) — the
 * GUI's Settings screen, opened by the sidebar's gear button, the desktop app's ⌘, menu item, or
 * `/settings` (its `show-settings` `ui_intent` calls `state.openSettings()`, wired in
 * `useSessionClient`). Every change applies at once; there is no Save button. Esc and the Close
 * button both close it and return focus to whatever opened it (`Dialog` owns that).
 */
export function SettingsScreen({ state }: { state: IWsSessionState }): React.ReactElement | null {
  const [activeSectionId, setActiveSectionId] = useState<string>('general');
  // Narrow layout only: true shows the section LIST; false shows the selected section's content,
  // pushed in over the list, with the Back button above returning to it.
  const [showList, setShowList] = useState(true);
  const [pendingSkipAllChecks, setPendingSkipAllChecks] = useState<TPendingSkipAllChecks | null>(
    null,
  );
  const [pendingRuleRemoval, setPendingRuleRemoval] = useState<ISettingsPermissionRule | null>(
    null,
  );
  const [pendingPluginAction, setPendingPluginAction] = useState<TPendingPluginAction | null>(null);
  const [mcpReloading, setMcpReloading] = useState(false);
  const [pluginsReloading, setPluginsReloading] = useState(false);

  // Each time the screen opens, land on the section the opener asked for (`/plugin` → Plugins;
  // the gear and `/settings` ask for none, which lands on General) and, for narrow windows, on the
  // section list.
  useEffect(() => {
    if (!state.settingsOpen) return;
    setActiveSectionId(state.settingsInitialSectionId ?? 'general');
    setShowList(true);
  }, [state.settingsOpen, state.settingsInitialSectionId]);

  // A reply to ANY request clears a reload spinner — the common case is the reload's own reply;
  // a snapshot refreshed from elsewhere in the meantime is a reasonable time to stop showing it too.
  useEffect(() => {
    setMcpReloading(false);
    setPluginsReloading(false);
  }, [state.settingsSnapshot]);

  if (!state.settingsOpen) return null;

  const snapshot = state.settingsSnapshot;
  const activeSection = SECTIONS.find((section) => section.id === activeSectionId) ?? SECTIONS[0];

  function selectSection(id: string): void {
    setActiveSectionId(id);
    setShowList(false);
  }

  function requestPermissionModeChange(mode: string): void {
    if (snapshot && mode === snapshot.permissionMode.skipsAllChecksMode) {
      setPendingSkipAllChecks({ kind: 'mode' });
      return;
    }
    state.updateSettings({ field: 'permissionMode', mode });
  }

  function requestPresetChange(presetId: string): void {
    if (snapshot?.preset.skipsAllChecksPresetIds.includes(presetId)) {
      setPendingSkipAllChecks({ kind: 'preset', presetId });
      return;
    }
    state.updateSettings({ field: 'preset', presetId });
  }

  function reloadMcpServers(): void {
    setMcpReloading(true);
    state.updateSettings({ field: 'reloadMcpServers' });
  }

  function reloadPlugins(): void {
    setPluginsReloading(true);
    state.updateSettings({ field: 'reloadPlugins' });
  }

  function confirmPluginAction(): void {
    if (pendingPluginAction?.kind === 'install') {
      state.updateSettings({ field: 'installPlugin', pluginId: pendingPluginAction.pluginId });
    } else if (pendingPluginAction?.kind === 'uninstall') {
      state.updateSettings({ field: 'uninstallPlugin', pluginId: pendingPluginAction.plugin.id });
    }
    setPendingPluginAction(null);
  }

  return (
    <>
      <Dialog
        open
        onClose={() => state.closeSettings()}
        title="Settings"
        panelClassName="flex h-[min(680px,85vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none"
      >
        <div className="flex h-12 flex-shrink-0 items-center gap-1 border-b border-border px-3">
          {!showList ? (
            <button
              type="button"
              aria-label="Back to sections"
              onClick={() => setShowList(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground md:hidden"
            >
              <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
          ) : null}
          <h2 className="px-1.5 text-[15px] font-semibold text-foreground">Settings</h2>
          <button
            type="button"
            aria-label="Close Settings"
            onClick={() => state.closeSettings()}
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X size={17} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className={`w-full flex-shrink-0 overflow-y-auto border-r border-border bg-sidebar px-2 py-3 md:block md:w-[200px] ${
              showList ? 'block' : 'hidden'
            }`}
          >
            <ul className="space-y-0.5">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => selectSection(section.id)}
                    aria-current={section.id === activeSectionId ? 'true' : undefined}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-[13.5px] ${
                      section.id === activeSectionId
                        ? 'bg-raised font-medium text-foreground'
                        : 'text-foreground/85 hover:bg-hover'
                    }`}
                  >
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div
            className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 md:block ${
              showList ? 'hidden' : 'block'
            }`}
          >
            {snapshot === null ? (
              state.settingsStatus === 'error' ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-[13.5px] text-destructive">
                    {state.settingsError ?? 'Settings could not be read.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => state.openSettings()}
                    className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-foreground hover:bg-hover"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">Loading settings…</p>
              )
            ) : (
              <>
                {state.settingsError ? (
                  <p className="mb-3 rounded-lg bg-destructive/12 px-3 py-2 text-[13px] text-destructive">
                    {state.settingsError}
                  </p>
                ) : null}
                {activeSection.id === 'general' ? (
                  <SettingsGeneralSection
                    snapshot={snapshot}
                    onUpdate={state.updateSettings}
                    onRequestPresetChange={requestPresetChange}
                  />
                ) : activeSection.id === 'mcp' ? (
                  <SettingsMcpSection
                    snapshot={snapshot}
                    onToggleServer={(serverId, enabled) =>
                      state.updateSettings({ field: 'mcpServerEnabled', serverId, enabled })
                    }
                    onReload={reloadMcpServers}
                    reloading={mcpReloading}
                  />
                ) : activeSection.id === 'plugins' ? (
                  <SettingsPluginsSection
                    snapshot={snapshot}
                    onTogglePlugin={(pluginId, enabled) =>
                      state.updateSettings({ field: 'pluginEnabled', pluginId, enabled })
                    }
                    onReload={reloadPlugins}
                    reloading={pluginsReloading}
                    onRequestInstall={(pluginId) => setPendingPluginAction({ kind: 'install', pluginId })}
                    onRequestUninstall={(plugin) => setPendingPluginAction({ kind: 'uninstall', plugin })}
                  />
                ) : (
                  <SettingsPermissionsSection
                    snapshot={snapshot}
                    onRequestModeChange={requestPermissionModeChange}
                    onToggleSandbox={(enabled) => state.updateSettings({ field: 'sandbox', enabled })}
                    onRequestRemoveRule={(rule) => setPendingRuleRemoval(rule)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingSkipAllChecks !== null}
        title="Skip all permission checks?"
        body="Every action runs without asking first — file edits, shell commands and network access included. You can turn this back on at any time."
        confirmLabel="Skip all checks"
        destructive
        onCancel={() => setPendingSkipAllChecks(null)}
        onConfirm={() => {
          if (pendingSkipAllChecks?.kind === 'mode' && snapshot) {
            state.updateSettings({
              field: 'permissionMode',
              mode: snapshot.permissionMode.skipsAllChecksMode,
            });
          } else if (pendingSkipAllChecks?.kind === 'preset') {
            state.updateSettings({ field: 'preset', presetId: pendingSkipAllChecks.presetId });
          }
          setPendingSkipAllChecks(null);
        }}
      />

      <ConfirmDialog
        open={pendingRuleRemoval !== null}
        title="Remove this rule?"
        body={pendingRuleRemoval ? describePermissionRuleRemoval(pendingRuleRemoval) : ''}
        confirmLabel="Remove"
        destructive
        onCancel={() => setPendingRuleRemoval(null)}
        onConfirm={() => {
          if (pendingRuleRemoval) {
            state.updateSettings({
              field: 'removePermissionRule',
              scope: pendingRuleRemoval.scope,
              kind: pendingRuleRemoval.kind,
              pattern: pendingRuleRemoval.pattern,
            });
          }
          setPendingRuleRemoval(null);
        }}
      />

      <ConfirmDialog
        open={pendingPluginAction !== null}
        title={pendingPluginAction?.kind === 'uninstall' ? 'Uninstall this plugin?' : 'Install this plugin?'}
        body={pendingPluginAction ? describePluginAction(pendingPluginAction) : ''}
        confirmLabel={pendingPluginAction?.kind === 'uninstall' ? 'Uninstall' : 'Install'}
        destructive
        onCancel={() => setPendingPluginAction(null)}
        onConfirm={confirmPluginAction}
      />
    </>
  );
}

/** Splits `<name>@<marketplace>` for the confirmation copy; a bare name shows with no source. */
function describePluginAction(action: TPendingPluginAction): string {
  if (action.kind === 'uninstall') {
    return `"${action.plugin.name}" will be removed from this computer.`;
  }
  const at = action.pluginId.lastIndexOf('@');
  const name = at === -1 ? action.pluginId : action.pluginId.slice(0, at);
  const source = at === -1 ? undefined : action.pluginId.slice(at + 1);
  return `Install "${name}"${source ? ` from ${source}` : ''}. It can run code on this computer.`;
}
