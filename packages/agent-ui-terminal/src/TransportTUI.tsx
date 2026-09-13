/**
 * TransportTUI — interactive overlay for transport enable/disable settings.
 *
 * Arrow keys navigate the list, space toggles enabled/disabled, enter/esc closes.
 *
 * TRANS-009: a toggle SAVES a setting. It does not start or stop anything — `registry.setEnabled`
 * writes the settings file and returns, and `startAll` reads `getEnabled()` when a session starts, so
 * the change takes effect at the next start. This component used to render `[enabled]` on the way
 * back from that write, which told the user a transport was running when nothing had been started.
 *
 * The badge therefore names the SAVED setting and the footer says when it applies. And a failed write
 * is rendered rather than swallowed: the previous `.catch(() => setSaving(false))` took the error and
 * discarded it, so a settings file that could not be written looked exactly like a successful save
 * with the row unchanged.
 */

import { Box, useInput } from 'ink';
import React, { useState, useCallback } from 'react';

import { Text } from './SafeText.js';
import { PALETTE } from './tui-palette.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportEntry,
  ITransportSettingsRegistryView,
} from '@robota-sdk/agent-interface-transport';

const TRANSPORT_NAME_WIDTH = 18;

interface IEntryRowProps {
  entry: ITransportEntry<IInteractiveSession>;
  selected: boolean;
}

function TransportEntryRow({ entry, selected }: IEntryRowProps): React.ReactElement {
  const enabled = entry.config.enabled;
  const dot = enabled ? '●' : '○';
  // The saved setting, not a running state — see the file header.
  const badge = enabled ? '[on] ' : '[off]';
  const portOpt = entry.config.options?.port;
  const portHint = typeof portOpt === 'number' ? `port: ${portOpt}` : '';
  return (
    <Box>
      <Text color={selected ? PALETTE.text.accent : undefined} bold={selected}>
        {`${dot} ${entry.transport.name.padEnd(TRANSPORT_NAME_WIDTH)} ${badge}  ${portHint}`}
      </Text>
    </Box>
  );
}

type TKey = { upArrow: boolean; downArrow: boolean; escape: boolean; return: boolean };

function useTransportInput(
  entries: ITransportEntry<IInteractiveSession>[],
  cursor: number,
  saving: boolean,
  registry: ITransportSettingsRegistryView<IInteractiveSession>,
  setCursor: (fn: (c: number) => number) => void,
  setSaving: (v: boolean) => void,
  setError: (v: string | undefined) => void,
  onClose: () => void,
  refresh: () => void,
): void {
  useInput(
    useCallback(
      (_input: string, key: TKey) => {
        if (saving) return;
        if (key.upArrow) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.downArrow) {
          setCursor((c) => Math.min(entries.length - 1, c + 1));
          return;
        }
        if (key.escape || key.return) {
          onClose();
          return;
        }
        if (_input === ' ') {
          const entry = entries[cursor];
          if (!entry) return;
          setSaving(true);
          setError(undefined);
          registry
            .setEnabled(entry.transport.name, !entry.config.enabled)
            .then(() => {
              refresh();
              setSaving(false);
            })
            .catch((cause: unknown) => {
              // The reason, not just the fact. A settings file that cannot be written and a
              // transport that refuses configuration are different problems for the user.
              setError(cause instanceof Error ? cause.message : 'could not save the setting');
              setSaving(false);
            });
        }
      },
      [saving, entries, cursor, registry, onClose, refresh, setCursor, setSaving, setError],
    ),
  );
}

interface IProps {
  registry: ITransportSettingsRegistryView<IInteractiveSession>;
  onClose: () => void;
}

export default function TransportTUI({ registry, onClose }: IProps): React.ReactElement {
  const [entries, setEntries] = useState(() => registry.getAll());
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const refresh = useCallback((): void => {
    setEntries(registry.getAll());
  }, [registry]);

  useTransportInput(
    entries,
    cursor,
    saving,
    registry,
    setCursor,
    setSaving,
    setError,
    onClose,
    refresh,
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Transports</Text>
      <Box marginTop={1} flexDirection="column">
        {entries.map((entry, i) => (
          <TransportEntryRow key={entry.transport.name} entry={entry} selected={i === cursor} />
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>↑↓ select space toggle enter/esc close</Text>
        <Text dimColor>A toggle is saved now and applies the next time Robota starts.</Text>
      </Box>
      {saving && (
        <Box marginTop={1}>
          <Text color={PALETTE.text.warning}>Saving…</Text>
        </Box>
      )}
      {error !== undefined && (
        <Box marginTop={1}>
          <Text color={PALETTE.text.error}>{`Not saved — ${error}`}</Text>
        </Box>
      )}
    </Box>
  );
}
