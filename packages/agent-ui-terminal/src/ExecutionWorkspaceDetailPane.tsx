import { Box } from 'ink';
import React from 'react';

import {
  formatExecutionDetailRecord,
  formatExecutionWorkspaceEntryRow,
  formatFollowRows,
} from './execution-workspace-view-model.js';
import { attachKind } from '@robota-sdk/agent-framework';
import { useKeybindingHints } from './keybindings/keybindings-context.js';
import { Text } from './SafeText.js';
import { STATUS_SYMBOL, statusGlyphColor } from './status-glyph.js';
import { usePalette } from './theme/index.js';

import type { IThemeColors } from './theme/index.js';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  TExecutionDetailRecordKind,
} from '@robota-sdk/agent-interface-execution';

const MAX_VISIBLE_DETAIL_RECORDS = 12;

interface IProps {
  entry: IExecutionWorkspaceEntry;
  page: IExecutionDetailPage | null;
  loading?: boolean;
  error?: string;
}

export default function ExecutionWorkspaceDetailPane({
  entry,
  page,
  loading,
  error,
}: IProps): React.ReactElement {
  const palette = usePalette();
  const row = formatExecutionWorkspaceEntryRow(entry, { selectedEntryId: entry.id });
  const kind = attachKind(entry);
  const records =
    kind === 'none'
      ? (page?.records.slice(-MAX_VISIBLE_DETAIL_RECORDS) ?? [])
      : formatFollowRows(page?.records ?? []);
  const backHint = useKeybindingHints('background-detail', [
    ['return-to-main', 'Back to the main thread'],
  ]);
  const earlierHint = useKeybindingHints('background-detail', [
    ['follow-earlier', 'Earlier output'],
  ]);
  const switchHint = useKeybindingHints('app', [['open-workspace-switcher', 'open the workspace']]);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.text.accent} bold>
        {`${kind === 'follow' ? 'Following' : 'Viewing'} ${row.title}`}
      </Text>
      <Text dimColor>
        {row.statusLabel}
        {row.subtitle ? ` · ${row.subtitle}` : ''}
        {row.preview ? ` · ${row.preview}` : ''}
      </Text>
      {loading ? <Text dimColor>Loading workspace detail...</Text> : null}
      {error ? <Text color={palette.text.error}>{error}</Text> : null}
      {!loading && !error && records.length === 0 ? <Text dimColor>No detail yet</Text> : null}
      {!loading &&
        !error &&
        records.map((record) => {
          const { symbol, color } = getDetailRecordGlyph(record.kind, palette);
          return (
            <Text key={record.id} color={color}>
              {symbol ? `${symbol} ` : ''}
              {kind === 'none' ? formatExecutionDetailRecord(record) : record.text}
            </Text>
          );
        })}
      {page?.nextCursor ? <Text dimColor>... more detail available</Text> : null}
      {kind !== 'none' && (
        <Text dimColor>{earlierHint.map((hint) => `${hint.keys} ${hint.label}`).join(' · ')}</Text>
      )}
      {kind === 'follow' && (
        <Text dimColor>
          {entry.controls.includes('send') ? 'Type to message this job · ' : ''}
          {backHint.map((hint) => `${hint.keys} ${hint.label}`).join(' · ')}
        </Text>
      )}
      {kind === 'continue' && (
        <Text dimColor>
          This job has ended · {switchHint.map((hint) => hint.keys).join('/')} to continue it as a
          session
        </Text>
      )}
    </Box>
  );
}

/**
 * Symbol + color per detail-record kind. A symbol always accompanies the color
 * so status is legible without color (no color-only encoding).
 */
function getDetailRecordGlyph(
  kind: TExecutionDetailRecordKind,
  palette: IThemeColors,
): {
  symbol: string;
  color: string | undefined;
} {
  if (kind === 'error')
    return { symbol: STATUS_SYMBOL.error, color: statusGlyphColor(palette, 'error') };
  if (kind === 'result')
    return { symbol: STATUS_SYMBOL.success, color: statusGlyphColor(palette, 'success') };
  if (kind === 'group_summary') return { symbol: '▸', color: palette.text.accent };
  if (kind === 'process_output') return { symbol: '·', color: palette.text.emphasis };
  return { symbol: '', color: undefined };
}
