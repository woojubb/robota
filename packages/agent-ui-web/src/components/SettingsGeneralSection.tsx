import React from 'react';

import { SettingsLanguageField, SettingsPopupField } from './SettingsFields.js';

import type { ISettingsSnapshot, TSettingsPatch } from '@robota-sdk/agent-interface-session';

/**
 * Language, output style and preset — reusing the exact choices and descriptions the runtime
 * already builds for `/language`, `/output-style` and `/preset` (#3282 §4a). Never internal ids:
 * every pop-up shows the runtime's human labels.
 */
export function SettingsGeneralSection({
  snapshot,
  onUpdate,
  onRequestPresetChange,
}: {
  snapshot: ISettingsSnapshot;
  onUpdate: (patch: TSettingsPatch) => void;
  /** Routed through the parent so it can confirm a preset that would skip every check. */
  onRequestPresetChange: (presetId: string) => void;
}): React.ReactElement {
  return (
    <section aria-labelledby="settings-general-heading">
      <h3 id="settings-general-heading" className="sr-only">
        General
      </h3>
      <SettingsLanguageField
        label="Language"
        current={snapshot.language.current}
        recommended={snapshot.language.recommended}
        note={snapshot.language.appliesNote}
        onChange={(language) => onUpdate({ field: 'language', language })}
      />
      <SettingsPopupField
        label="Output style"
        value={snapshot.outputStyle.current}
        options={snapshot.outputStyle.choices}
        onChange={(styleId) => onUpdate({ field: 'outputStyle', styleId })}
      />
      <SettingsPopupField
        label="Preset"
        note="Applies to this session — it is not saved for the next one."
        value={snapshot.preset.current}
        options={snapshot.preset.choices}
        onChange={onRequestPresetChange}
      />
    </section>
  );
}
