import { Trash2 } from 'lucide-react';
import React, { useId } from 'react';

import { SettingsPopupField } from './SettingsFields.js';

import type { ISettingsPermissionRule, ISettingsSnapshot } from '@robota-sdk/agent-interface-session';

const KIND_LABEL: Readonly<Record<ISettingsPermissionRule['kind'], string>> = {
  allow: 'Allow',
  deny: 'Deny',
  ask: 'Ask',
};

const KIND_VERB: Readonly<Record<ISettingsPermissionRule['kind'], string>> = {
  allow: 'allowed',
  deny: 'denied',
  ask: 'asked about',
};

function PermissionRuleRow({
  rule,
  onRequestRemove,
}: {
  rule: ISettingsPermissionRule;
  onRequestRemove: (rule: ISettingsPermissionRule) => void;
}): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-hover">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] text-foreground">
          <span className="font-medium">{KIND_LABEL[rule.kind]}</span>{' '}
          <span className="font-mono text-[12.5px]">{rule.pattern}</span>
        </p>
        <p className="truncate text-[12px] text-muted-foreground">{rule.source}</p>
      </div>
      {rule.removable ? (
        <button
          type="button"
          aria-label={`Remove rule: ${KIND_LABEL[rule.kind]} ${rule.pattern}`}
          onClick={() => onRequestRemove(rule)}
          className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-destructive"
        >
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      ) : null}
    </li>
  );
}

/**
 * Default permission mode, the rules `/permissions` shows, and the sandbox switch (#3282 §4a).
 * "Skip all checks" as the mode and a preset that would set it both go through
 * `onRequestModeChange`'s parent-owned confirmation before anything is sent.
 */
export function SettingsPermissionsSection({
  snapshot,
  onRequestModeChange,
  onToggleSandbox,
  onRequestRemoveRule,
}: {
  snapshot: ISettingsSnapshot;
  onRequestModeChange: (mode: string) => void;
  onToggleSandbox: (enabled: boolean) => void;
  onRequestRemoveRule: (rule: ISettingsPermissionRule) => void;
}): React.ReactElement {
  const sandboxLabelId = useId();
  const { sandbox } = snapshot;

  return (
    <section aria-labelledby="settings-permissions-heading" className="flex flex-col gap-5">
      <div>
        <h3 id="settings-permissions-heading" className="sr-only">
          Permissions
        </h3>
        <SettingsPopupField
          label="Default permission mode"
          value={snapshot.permissionMode.current}
          options={snapshot.permissionMode.choices}
          onChange={onRequestModeChange}
        />
      </div>

      <div>
        <h4 className="mb-1.5 text-[13px] font-medium text-foreground">Rules</h4>
        {snapshot.permissionRules.length === 0 ? (
          <p className="text-[13px] leading-snug text-muted-foreground">
            No permission rules are configured — the default mode above governs every action.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {snapshot.permissionRules.map((rule) => (
              <PermissionRuleRow key={rule.id} rule={rule} onRequestRemove={onRequestRemoveRule} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-4">
        <div className="min-w-0">
          <span id={sandboxLabelId} className="text-[14px] font-medium text-foreground">
            Sandbox
          </span>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            {sandbox.description}
          </p>
          {!sandbox.available && sandbox.unavailableReason ? (
            <p className="mt-0.5 text-[12.5px] text-destructive">
              Not available on this machine: {sandbox.unavailableReason}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sandbox.enabled}
          aria-labelledby={sandboxLabelId}
          disabled={!sandbox.available}
          onClick={() => onToggleSandbox(!sandbox.enabled)}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            sandbox.enabled ? 'bg-primary' : 'bg-raised'
          } ${!sandbox.available ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              sandbox.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </section>
  );
}

/** Reused by the removal confirmation copy in `SettingsScreen`. */
export function describePermissionRuleRemoval(rule: ISettingsPermissionRule): string {
  return `"${rule.pattern}" will no longer be ${KIND_VERB[rule.kind]} automatically.`;
}
