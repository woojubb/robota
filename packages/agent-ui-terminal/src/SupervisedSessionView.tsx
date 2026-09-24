import { Box, render, useApp, useInput, useStdout } from 'ink';
import React, { useEffect, useMemo, useState } from 'react';

import { useNumberedSelection } from './hooks/useNumberedSelection.js';
import { formatNumberedSelectionPrompt, numberedRowPrefix } from './numbered-list.js';
import { Text } from './SafeText.js';
import { writeScreenReaderAnnouncement, type TScreenReaderChannel } from './screen-reader-announcement.js';
import { ScreenReaderProvider, useScreenReader } from './screen-reader-context.js';

export interface ISupervisedViewRow {
  readonly id: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  readonly control: 'available' | 'unavailable';
  readonly activity: 'working' | 'needs-input' | 'idle' | 'unknown';
  readonly problem?: 'invalid-registration';
}

export interface ISupervisedSessionViewProps {
  readonly loadRows: (signal: AbortSignal) => Promise<readonly ISupervisedViewRow[]>;
  readonly refreshMs?: number;
}

const GROUP_ORDER = ['needs-input', 'working', 'idle', 'unknown', 'unverified', 'dead'] as const;
type TGroup = typeof GROUP_ORDER[number];

function groupOf(row: ISupervisedViewRow): TGroup {
  if (row.liveness === 'dead') return 'dead';
  if (row.liveness !== 'alive' || row.control !== 'available') return 'unverified';
  return row.activity;
}

function sortedRows(rows: readonly ISupervisedViewRow[]): readonly ISupervisedViewRow[] {
  return [...rows].sort((a, b) =>
    GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b)) || a.id.localeCompare(b.id));
}

function sameRows(a: readonly ISupervisedViewRow[], b: readonly ISupervisedViewRow[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return other !== undefined && row.id === other.id && row.liveness === other.liveness &&
      row.control === other.control && row.activity === other.activity && row.problem === other.problem;
  });
}

export default function SupervisedSessionView({
  loadRows,
  refreshMs = 2_000,
}: ISupervisedSessionViewProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const screenReader = useScreenReader();
  const [rows, setRows] = useState<readonly ISupervisedViewRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showHelp, setShowHelp] = useState(false);
  const ordered = useMemo(() => sortedRows(rows), [rows]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = sortedRows(await loadRows(controller.signal));
        if (!mounted || controller.signal.aborted) return;
        setRows((previous) => sameRows(previous, next) ? previous : next);
        setStatus('ready');
      } catch {
        if (mounted && !controller.signal.aborted) setStatus('unavailable');
      } finally {
        if (mounted && !controller.signal.aborted) timer = setTimeout(() => { void poll(); }, refreshMs);
      }
    };
    void poll();
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [loadRows, refreshMs]);

  useEffect(() => {
    setSelectedId((current) => current !== undefined && ordered.some((row) => row.id === current)
      ? current : ordered[0]?.id);
  }, [ordered]);

  useInput((input, key) => {
    if (input === 'q' || (!screenReader && key.escape) || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === '?') {
      setShowHelp((value) => !value);
      return;
    }
    if (screenReader || ordered.length === 0) return;
    if (key.upArrow || key.downArrow) {
      const index = Math.max(0, ordered.findIndex((row) => row.id === selectedId));
      const next = Math.max(0, Math.min(ordered.length - 1, index + (key.downArrow ? 1 : -1)));
      setSelectedId(ordered[next]?.id);
    }
  });

  const numbered = useNumberedSelection({
    enabled: screenReader,
    itemCount: ordered.length,
    cancellable: true,
    onSelect: (index) => setSelectedId(ordered[index]?.id),
    onCancel: exit,
  });

  const height = Math.max(8, stdout.rows ?? 24);
  const viewport = Math.max(1, height - 7);
  const selectedIndex = Math.max(0, ordered.findIndex((row) => row.id === selectedId));
  const start = Math.min(Math.max(0, selectedIndex - Math.floor(viewport / 2)), Math.max(0, ordered.length - viewport));
  const visible = screenReader ? ordered : ordered.slice(start, start + viewport);

  return (
    <Box flexDirection="column" {...(screenReader ? {} : { height })}>
      <Text>Background sessions across projects</Text>
      <Text>{ordered.length} supervised session(s). Foreground peers and saved records are separate.</Text>
      {status === 'loading' && <Text>Loading supervised sessions...</Text>}
      {status === 'unavailable' && <Text>Supervised session discovery unavailable; last verified rows remain below.</Text>}
      {status === 'ready' && ordered.length === 0 && <Text>No supervised sessions.</Text>}
      {start > 0 && !screenReader && <Text>{start} more above</Text>}
      {visible.map((row, index) => {
        const group = groupOf(row);
        const previous = visible[index - 1];
        return (
          <React.Fragment key={row.id}>
            {(previous === undefined || groupOf(previous) !== group) && <Text>{group}:</Text>}
            <Text>
              {screenReader ? numberedRowPrefix(index) : row.id === selectedId ? '> ' : '  '}
              {row.id}  activity {row.activity}  liveness {row.liveness}  control {row.control}
              {row.problem ? `  ${row.problem}` : ''}
            </Text>
          </React.Fragment>
        );
      })}
      {!screenReader && start + visible.length < ordered.length &&
        <Text>{ordered.length - start - visible.length} more below</Text>}
      {selectedId !== undefined && <Text>Selected {selectedId}</Text>}
      {screenReader && ordered.length > 0 &&
        <Text>{formatNumberedSelectionPrompt(ordered.length, true)}{numbered.buffer ? ` ${numbered.buffer}` : ''}</Text>}
      {screenReader && numbered.invalid && <Text>Selection out of range.</Text>}
      <Text>{screenReader ? 'Type a number and Enter to select; Escape to close; ? for help.' : '↑↓ Navigate  ? Help  q/Esc Close'}</Text>
      {showHelp && <Text>Activity is not process liveness. Idle does not allow attach. Closing this view does not stop sessions.</Text>}
    </Box>
  );
}

export async function renderSupervisedSessionView(
  options: ISupervisedSessionViewProps & {
    readonly screenReader: boolean;
    readonly screenReaderChannel?: TScreenReaderChannel;
    readonly screenReaderHint?: boolean;
  },
): Promise<void> {
  writeScreenReaderAnnouncement({
    enabled: options.screenReader,
    channel: options.screenReaderChannel,
    hint: options.screenReaderHint,
  });
  const instance = render(
    <ScreenReaderProvider enabled={options.screenReader}>
      <SupervisedSessionView loadRows={options.loadRows} refreshMs={options.refreshMs} />
    </ScreenReaderProvider>,
    { isScreenReaderEnabled: options.screenReader },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
  }
}
