import { Box, Text } from 'ink';
import React from 'react';

import {
  formatExecutionDetailRecord,
  formatExecutionWorkspaceEntryRow,
} from './execution-workspace-view-model.js';
import { STATUS_GLYPH } from './status-glyph.js';
import { PALETTE } from './tui-palette.js';

import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  TExecutionDetailRecordKind,
} from '@robota-sdk/agent-interface-transport';

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
  const row = formatExecutionWorkspaceEntryRow(entry, { selectedEntryId: entry.id });
  const records = page?.records.slice(-MAX_VISIBLE_DETAIL_RECORDS) ?? [];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={PALETTE.text.accent} bold>
        {`Viewing ${row.title}`}
      </Text>
      <Text dimColor>
        {row.statusLabel}
        {row.subtitle ? ` · ${row.subtitle}` : ''}
        {row.preview ? ` · ${row.preview}` : ''}
      </Text>
      {loading ? <Text dimColor>Loading workspace detail...</Text> : null}
      {error ? <Text color={PALETTE.text.error}>{error}</Text> : null}
      {!loading && !error && records.length === 0 ? <Text dimColor>No detail yet</Text> : null}
      {!loading &&
        !error &&
        records.map((record) => {
          const { symbol, color } = getDetailRecordGlyph(record.kind);
          return (
            <Text key={record.id} color={color}>
              {symbol ? `${symbol} ` : ''}
              {formatExecutionDetailRecord(record)}
            </Text>
          );
        })}
      {page?.nextCursor ? <Text dimColor>... more detail available</Text> : null}
    </Box>
  );
}

/**
 * Symbol + color per detail-record kind. A symbol always accompanies the color
 * so status is legible without color (SCREEN-005 — no color-only encoding).
 */
function getDetailRecordGlyph(kind: TExecutionDetailRecordKind): {
  symbol: string;
  color: string | undefined;
} {
  if (kind === 'error')
    return { symbol: STATUS_GLYPH.error.symbol, color: STATUS_GLYPH.error.color };
  if (kind === 'result')
    return { symbol: STATUS_GLYPH.success.symbol, color: STATUS_GLYPH.success.color };
  if (kind === 'group_summary') return { symbol: '▸', color: PALETTE.text.accent };
  if (kind === 'process_output') return { symbol: '·', color: PALETTE.text.emphasis };
  return { symbol: '', color: undefined };
}
