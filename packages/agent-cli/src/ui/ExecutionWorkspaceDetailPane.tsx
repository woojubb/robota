import React from 'react';
import { Box, Text } from 'ink';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  TExecutionDetailRecordKind,
} from '@robota-sdk/agent-sdk';
import {
  formatExecutionDetailRecord,
  formatExecutionWorkspaceEntryRow,
} from './execution-workspace-view-model.js';

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
      <Text color="cyan" bold>
        {`Viewing ${row.title}`}
      </Text>
      <Text dimColor>
        {row.statusLabel}
        {row.subtitle ? ` · ${row.subtitle}` : ''}
        {row.preview ? ` · ${row.preview}` : ''}
      </Text>
      {loading ? <Text dimColor>Loading workspace detail...</Text> : null}
      {error ? <Text color="red">{error}</Text> : null}
      {!loading && !error && records.length === 0 ? <Text dimColor>No detail yet</Text> : null}
      {!loading &&
        !error &&
        records.map((record) => (
          <Text key={record.id} color={getDetailRecordColor(record.kind)}>
            {formatExecutionDetailRecord(record)}
          </Text>
        ))}
      {page?.nextCursor ? <Text dimColor>... more detail available</Text> : null}
    </Box>
  );
}

function getDetailRecordColor(kind: TExecutionDetailRecordKind): string | undefined {
  if (kind === 'error') return 'red';
  if (kind === 'result') return 'green';
  if (kind === 'process_output') return 'white';
  if (kind === 'group_summary') return 'cyan';
  return undefined;
}
