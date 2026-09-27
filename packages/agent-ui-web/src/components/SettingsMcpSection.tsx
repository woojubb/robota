'use client';

import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import React, { useId, useState } from 'react';

import type { ISettingsMcpServer, ISettingsSnapshot } from '@robota-sdk/agent-interface-session';

const STATUS_LABEL: Readonly<Record<ISettingsMcpServer['status'], string>> = {
  connected: 'Connected',
  failed: 'Failed',
  disabled: 'Disabled',
};

const STATUS_CLASS: Readonly<Record<ISettingsMcpServer['status'], string>> = {
  connected: 'text-success',
  failed: 'text-destructive',
  disabled: 'text-muted-foreground',
};

function ServerRow({
  server,
  expanded,
  onToggleExpanded,
  onToggleEnabled,
}: {
  server: ISettingsMcpServer;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}): React.ReactElement {
  const labelId = useId();
  const canExpand = server.toolNames.length > 0;
  return (
    <li className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={canExpand ? onToggleExpanded : undefined}
            disabled={!canExpand}
            aria-expanded={canExpand ? expanded : undefined}
            className="flex w-full items-center gap-1.5 text-left disabled:cursor-default"
          >
            {canExpand ? (
              expanded ? (
                <ChevronDown size={14} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight size={14} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-[14px] flex-shrink-0" />
            )}
            <span id={labelId} className="truncate text-[14px] font-medium text-foreground">
              {server.name}
            </span>
          </button>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {server.scopeLabel} · <span className={STATUS_CLASS[server.status]}>{STATUS_LABEL[server.status]}</span>
            {server.status === 'failed' && server.statusReason ? `: ${server.statusReason}` : ''}
            {' · '}
            {server.toolNames.length === 1 ? '1 tool' : `${server.toolNames.length} tools`}
          </p>
          {expanded && canExpand ? (
            <ul className="mt-2 flex flex-col gap-0.5 pl-[20px]">
              {server.toolNames.map((toolName) => (
                <li key={toolName} className="truncate font-mono text-[12px] text-muted-foreground">
                  {toolName}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={server.enabled}
          aria-labelledby={labelId}
          onClick={() => onToggleEnabled(!server.enabled)}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            server.enabled ? 'bg-primary' : 'bg-raised'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              server.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </li>
  );
}

/**
 * The MCP Servers section (#3282 §4 part b-2): every configured server's name, where it is
 * configured, its live connection status and tool count, an enable/disable switch (approve/reject),
 * an expandable list of its tool names, and a section-level Reload. Adding or editing a server is
 * left out — the runtime has no command path that writes MCP config (recorded in
 * `packages/agent-gui-web/docs/SPEC.md`).
 */
export function SettingsMcpSection({
  snapshot,
  onToggleServer,
  onReload,
  reloading,
}: {
  snapshot: ISettingsSnapshot;
  onToggleServer: (serverId: string, enabled: boolean) => void;
  onReload: () => void;
  reloading: boolean;
}): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const { servers } = snapshot.mcp;

  function toggleExpanded(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section aria-labelledby="settings-mcp-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="settings-mcp-heading" className="text-[14px] font-medium text-foreground">
          MCP Servers
        </h3>
        <button
          type="button"
          onClick={onReload}
          disabled={reloading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[13px] text-foreground hover:bg-hover disabled:opacity-60"
        >
          <RefreshCw size={13} strokeWidth={1.75} className={reloading ? 'animate-spin' : ''} />
          Reload servers
        </button>
      </div>
      {servers.length === 0 ? (
        <p className="text-[13px] leading-snug text-muted-foreground">No MCP servers are configured.</p>
      ) : (
        <ul>
          {servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              expanded={expandedIds.has(server.id)}
              onToggleExpanded={() => toggleExpanded(server.id)}
              onToggleEnabled={(enabled) => onToggleServer(server.id, enabled)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
