'use client';

import { Check } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { PopupMenu } from './PopupMenu.js';

import type { ISettingsProviderProfile, ISettingsSnapshot } from '@robota-sdk/agent-interface-session';
import type { TModelListSnapshot } from '../hooks/session-client-types.js';

const BUTTON =
  'rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON = `${BUTTON} bg-primary text-primary-foreground hover:opacity-90`;
const SECONDARY_BUTTON = `${BUTTON} bg-raised text-foreground hover:bg-hover`;
const DESTRUCTIVE_BUTTON = `${BUTTON} text-destructive hover:bg-destructive/10`;

/** The "Model" action: a `PopupMenu` of this ONE profile's catalog models (#3282 §4b). */
function ProviderModelButton({
  profile,
  modelList,
  onSelect,
}: {
  profile: ISettingsProviderProfile;
  modelList: TModelListSnapshot | null;
  onSelect: (profileName: string, modelId: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const models = modelList?.groups.find((group) => group.profileName === profile.name)?.models ?? [];
  return (
    <span className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={models.length === 0}
        onClick={() => setOpen(true)}
        className={SECONDARY_BUTTON}
      >
        Model
      </button>
      {open ? (
        <PopupMenu
          label={`Models for ${profile.name}`}
          sections={[
            {
              items: models.map((model) => ({
                key: model.id,
                label: model.label,
                checked: profile.model !== undefined && model.id === profile.model.id,
                onSelect: () => onSelect(profile.name, model.id),
              })),
            },
          ]}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

function ProviderProfileRow({
  profile,
  modelList,
  onUse,
  onModelChange,
  onCommand,
  onRequestDelete,
}: {
  profile: ISettingsProviderProfile;
  modelList: TModelListSnapshot | null;
  onUse: (profileName: string) => void;
  onModelChange: (profileName: string, modelId: string) => void;
  onCommand: (args: string) => void;
  onRequestDelete: (profileName: string) => void;
}): React.ReactElement {
  return (
    <li className="rounded-xl border border-border/60 p-3">
      <div className="flex items-start gap-1.5">
        {profile.current ? (
          <Check size={14} strokeWidth={2.25} className="mt-0.5 flex-shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <span className="mt-0.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-foreground">
            {profile.name}
            {profile.current ? <span className="sr-only"> (in use)</span> : null}
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {profile.providerLabel}
            {profile.model ? ` · ${profile.model.label}` : ' · No model configured'}
          </p>
          {profile.connectionState ? (
            <p className="text-[12.5px] text-destructive">{profile.connectionState}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={profile.current}
          onClick={() => onUse(profile.name)}
          className={PRIMARY_BUTTON}
        >
          Use
        </button>
        <ProviderModelButton profile={profile} modelList={modelList} onSelect={onModelChange} />
        <button
          type="button"
          onClick={() => onCommand(`edit ${profile.name}`)}
          className={SECONDARY_BUTTON}
        >
          Edit…
        </button>
        <button
          type="button"
          onClick={() => onCommand(`test ${profile.name}`)}
          className={SECONDARY_BUTTON}
        >
          Test connection
        </button>
        <button
          type="button"
          onClick={() => onCommand(`duplicate ${profile.name}`)}
          className={SECONDARY_BUTTON}
        >
          Duplicate…
        </button>
        <button
          type="button"
          onClick={() => onRequestDelete(profile.name)}
          className={`${DESTRUCTIVE_BUTTON} ml-auto`}
        >
          Delete…
        </button>
      </div>
    </li>
  );
}

/**
 * The configured provider profiles (#3282 §4b), each row a plain provider name, its model's label,
 * a checkmark on the one in use, and a plain connection state when one is known. Every action goes
 * through the same path the equivalent command does: Use/Model apply through `state.updateSettings`
 * (the same `field` patterns Preset/Mode/Sandbox use); Edit/Test/Duplicate/Add dispatch the raw
 * `/provider` command — driven by the SAME `ask_request` rendering the first-run setup panel and the
 * model menu's former "Manage providers…" flow already use, so a masked API key field and a
 * confirmation step need nothing new here.
 */
export function SettingsProvidersSection({
  snapshot,
  modelList,
  onRequestModelList,
  onUse,
  onModelChange,
  onCommand,
  onRequestDelete,
}: {
  snapshot: ISettingsSnapshot;
  modelList: TModelListSnapshot | null;
  onRequestModelList: () => void;
  onUse: (profileName: string) => void;
  onModelChange: (profileName: string, modelId: string) => void;
  /** Dispatches `/provider <args>` (Edit/Test/Duplicate) or `/provider add` (Add) unmodified. */
  onCommand: (args: string) => void;
  onRequestDelete: (profileName: string) => void;
}): React.ReactElement {
  // The "Model" button needs each profile's catalog as soon as this section is visible, not only
  // once a person opens one — `list-models` is a cheap, observer-safe read (#3282 §2).
  // Intentionally empty deps: fetch once per mount, not on every render.
  useEffect(() => {
    onRequestModelList();
  }, []);

  const { profiles } = snapshot.providers;

  return (
    <section aria-labelledby="settings-providers-heading" className="flex flex-col gap-4">
      <h3 id="settings-providers-heading" className="sr-only">
        Providers & Models
      </h3>
      {profiles.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground">No providers configured yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {profiles.map((profile) => (
            <ProviderProfileRow
              key={profile.name}
              profile={profile}
              modelList={modelList}
              onUse={onUse}
              onModelChange={onModelChange}
              onCommand={onCommand}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => onCommand('add')}
        className="self-start rounded-lg bg-raised px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-hover"
      >
        Add provider…
      </button>
    </section>
  );
}
