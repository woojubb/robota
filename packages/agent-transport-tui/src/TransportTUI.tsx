/**
 * TransportTUI — interactive overlay for transport enable/disable settings.
 *
 * Arrow keys navigate the list, space toggles enabled/disabled, enter/esc closes.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  ITransportEntry,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-sdk';

const TRANSPORT_NAME_WIDTH = 18;

interface IEntryRowProps {
  entry: ITransportEntry<IInteractiveSession>;
  selected: boolean;
}

function TransportEntryRow({ entry, selected }: IEntryRowProps): React.ReactElement {
  const enabled = entry.config.enabled;
  const dot = enabled ? '●' : '○';
  const badge = enabled ? '[enabled] ' : '[disabled]';
  const portOpt = entry.config.options?.port;
  const portHint = typeof portOpt === 'number' ? `port: ${portOpt}` : '';
  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined} bold={selected}>
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
  registry: ITransportRegistryView<IInteractiveSession>,
  setCursor: (fn: (c: number) => number) => void,
  setSaving: (v: boolean) => void,
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
          registry
            .setEnabled(entry.transport.name, !entry.config.enabled)
            .then(() => {
              refresh();
              setSaving(false);
            })
            .catch(() => setSaving(false));
        }
      },
      [saving, entries, cursor, registry, onClose, refresh, setCursor, setSaving],
    ),
  );
}

interface IProps {
  registry: ITransportRegistryView<IInteractiveSession>;
  onClose: () => void;
}

export default function TransportTUI({ registry, onClose }: IProps): React.ReactElement {
  const [entries, setEntries] = useState(() => registry.getAll());
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback((): void => {
    setEntries(registry.getAll());
  }, [registry]);

  useTransportInput(entries, cursor, saving, registry, setCursor, setSaving, onClose, refresh);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Transports</Text>
      <Box marginTop={1} flexDirection="column">
        {entries.map((entry, i) => (
          <TransportEntryRow key={entry.transport.name} entry={entry} selected={i === cursor} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ select space toggle enter/esc close</Text>
      </Box>
      {saving && (
        <Box marginTop={1}>
          <Text color="yellow">Saving…</Text>
        </Box>
      )}
    </Box>
  );
}
