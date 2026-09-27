'use client';

import React, { useEffect, useId, useState } from 'react';

import type { ISettingsChoice } from '@robota-sdk/agent-interface-session';

const SELECT_CLASS =
  'min-w-[160px] flex-shrink-0 rounded-lg border border-border bg-raised px-2.5 py-1.5 text-[13.5px] text-foreground';

/**
 * One row of the settings form: a plain label, a pop-up menu of `{id, label, description}` choices
 * (never a bare id) and, under it, the description of whichever choice is currently selected — HIG's
 * "a short plain description sits under each control." Selecting a choice applies AT ONCE.
 */
export function SettingsPopupField({
  label,
  note,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  /** A fixed note shown under the control instead of the selected choice's own description. */
  note?: string;
  value: string;
  options: readonly ISettingsChoice[];
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  const id = useId();
  const selected = options.find((option) => option.id === value);
  const description = note ?? selected?.description;
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-[14px] font-medium text-foreground">
          {label}
        </label>
        <select
          id={id}
          value={options.some((option) => option.id === value) ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={SELECT_CLASS}
        >
          {!options.some((option) => option.id === value) ? (
            <option value="" disabled>
              {value || 'Unset'}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {description ? (
        <p className="text-[12.5px] leading-snug text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

const OTHER = '__other__';

/**
 * The language control: a pop-up of the runtime's recommended languages, plus "Other…" — the
 * language is free text (any string the runtime accepts), so the recommended list is a shortcut,
 * never a validated enum. Applies on Enter or on leaving the free-text field.
 */
export function SettingsLanguageField({
  label,
  current,
  recommended,
  note,
  onChange,
  disabled = false,
}: {
  label: string;
  current: string;
  recommended: readonly ISettingsChoice[];
  note: string;
  onChange: (language: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  const id = useId();
  const isRecommended = recommended.some((choice) => choice.id === current);
  const [showOther, setShowOther] = useState(!isRecommended && current.length > 0);
  const [draft, setDraft] = useState(isRecommended ? '' : current);

  // A fresh snapshot (e.g. after a switch away and back) re-derives whether "Other…" is showing.
  useEffect(() => {
    const stillRecommended = recommended.some((choice) => choice.id === current);
    setShowOther(!stillRecommended && current.length > 0);
    setDraft(stillRecommended ? '' : current);
  }, [current, recommended]);

  function commitDraft(): void {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== current) onChange(trimmed);
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-[14px] font-medium text-foreground">
          {label}
        </label>
        <select
          id={id}
          disabled={disabled}
          value={showOther ? OTHER : isRecommended ? current : ''}
          onChange={(event) => {
            if (event.target.value === OTHER) {
              setShowOther(true);
              return;
            }
            setShowOther(false);
            onChange(event.target.value);
          }}
          className={SELECT_CLASS}
        >
          {!isRecommended && !showOther ? (
            <option value="" disabled>
              {current || 'Unset'}
            </option>
          ) : null}
          {recommended.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </div>
      {showOther ? (
        <input
          type="text"
          aria-label={`${label} — other`}
          placeholder="Language code, e.g. fr"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            }
          }}
          className="rounded-lg border border-border bg-raised px-2.5 py-1.5 text-[13.5px] text-foreground"
        />
      ) : null}
      <p className="text-[12.5px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}
