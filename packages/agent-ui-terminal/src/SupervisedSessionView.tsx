import { Box, render, useApp, useInput, useStdout } from 'ink';
import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  readonly onStop?: (id: string) => Promise<void>;
  readonly refreshMs?: number;
}

const GROUP_ORDER = ['needs-input', 'working', 'idle', 'unknown', 'unverified', 'dead'] as const;
type TGroup = typeof GROUP_ORDER[number];
type TDisplayLine =
  | { readonly kind: 'group'; readonly group: TGroup }
  | { readonly kind: 'row'; readonly row: ISupervisedViewRow; readonly index: number };

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
  onStop,
  refreshMs = 2_000,
}: ISupervisedSessionViewProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const screenReader = useScreenReader();
  const [rows, setRows] = useState<readonly ISupervisedViewRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showHelp, setShowHelp] = useState(false);
  const [confirmStopId, setConfirmStopId] = useState<string | undefined>();
  const [stopStatus, setStopStatus] = useState<'idle' | 'unavailable' | 'stopping' | 'stopped' | 'failed'>('idle');
  const [lastStoppedId, setLastStoppedId] = useState<string | undefined>();
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const ordered = useMemo(() => sortedRows(rows), [rows]);
  const displayLines = useMemo((): readonly TDisplayLine[] => {
    const lines: TDisplayLine[] = [];
    let previousGroup: TGroup | undefined;
    ordered.forEach((row, index) => {
      const group = groupOf(row);
      if (group !== previousGroup) lines.push({ kind: 'group', group });
      lines.push({ kind: 'row', row, index });
      previousGroup = group;
    });
    return lines;
  }, [ordered]);

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
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setSelectedId((current) => current !== undefined && ordered.some((row) => row.id === current)
      ? current : ordered[0]?.id);
  }, [ordered]);

  useInput((input, key) => {
    if (stoppingRef.current) return;
    if (confirmStopId !== undefined) {
      if (input === 'n' || key.escape) {
        setConfirmStopId(undefined);
        return;
      }
      if (input === 'y') {
        const row = rows.find((candidate) => candidate.id === confirmStopId);
        setConfirmStopId(undefined);
        if (status !== 'ready' || row?.liveness !== 'alive' || row.control !== 'available' || onStop === undefined) {
          setStopStatus('unavailable');
          return;
        }
        stoppingRef.current = true;
        setStopStatus('stopping');
        void onStop(confirmStopId).then(() => {
          if (!mountedRef.current) return;
          setLastStoppedId(confirmStopId);
          setStopStatus('stopped');
        }).catch(() => {
          if (mountedRef.current) setStopStatus('failed');
        }).finally(() => { stoppingRef.current = false; });
      }
      return;
    }
    if (input === 'q' || (!screenReader && key.escape) || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === '?') {
      setShowHelp((value) => !value);
      return;
    }
    if (input === 's' && onStop !== undefined) {
      const row = rows.find((candidate) => candidate.id === selectedId);
      if (status !== 'ready' || row?.liveness !== 'alive' || row.control !== 'available') {
        setStopStatus('unavailable');
      } else {
        setStopStatus('idle');
        setConfirmStopId(row.id);
      }
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
    enabled: screenReader && confirmStopId === undefined && stopStatus !== 'stopping',
    itemCount: ordered.length,
    cancellable: true,
    repeatable: true,
    onSelect: (index) => {
      setSelectedId(ordered[index]?.id);
      setStopStatus('idle');
    },
    onCancel: () => { if (!stoppingRef.current) exit(); },
  });

  const height = Math.max(8, stdout.rows ?? 24);
  // Reserve all fixed chrome plus both possible overflow indicators before choosing row lines.
  const fixedLines = 2 + (status === 'loading' || status === 'unavailable' || (status === 'ready' && ordered.length === 0) ? 1 : 0)
    + (selectedId === undefined ? 0 : 1) + (confirmStopId !== undefined || stopStatus !== 'idle' ? 1 : 0)
    + 1 + (showHelp ? 1 : 0) + 2;
  const viewport = Math.max(1, height - fixedLines);
  const selectedLine = Math.max(0, displayLines.findIndex((line) => line.kind === 'row' && line.row.id === selectedId));
  const start = Math.min(Math.max(0, selectedLine - Math.floor(viewport / 2)), Math.max(0, displayLines.length - viewport));
  const visible = screenReader ? displayLines : displayLines.slice(start, start + viewport);

  return (
    <Box flexDirection="column" {...(screenReader ? {} : { height })}>
      <Text>Background sessions across projects</Text>
      <Text>{ordered.length} supervised session(s). Foreground peers and saved records are separate.</Text>
      {status === 'loading' && <Text>Loading supervised sessions...</Text>}
      {status === 'unavailable' && <Text>Supervised session discovery unavailable; last verified rows remain below.</Text>}
      {status === 'ready' && ordered.length === 0 && <Text>No supervised sessions.</Text>}
      {start > 0 && !screenReader && <Text>{start} more above</Text>}
      {visible.map((line) => line.kind === 'group'
        ? <Text key={`group-${line.group}`}>{line.group}:</Text>
        : <Text key={`row-${line.row.id}`} {...(screenReader ? {} : { wrap: 'truncate-end' as const })}>
          {screenReader ? numberedRowPrefix(line.index) : line.row.id === selectedId ? '> ' : '  '}
          {line.row.id}  activity {line.row.activity}  liveness {line.row.liveness}  control {line.row.control}
          {line.row.problem ? `  ${line.row.problem}` : ''}
        </Text>)}
      {!screenReader && start + visible.length < displayLines.length &&
        <Text>{displayLines.length - start - visible.length} more below</Text>}
      {selectedId !== undefined && <Text>Selected {selectedId}</Text>}
      {confirmStopId !== undefined && <Text>Stop {confirmStopId}? y Yes / n No</Text>}
      {confirmStopId === undefined && stopStatus === 'unavailable' && <Text>This session cannot be stopped from the view.</Text>}
      {stopStatus === 'stopping' && <Text>Stopping selected session; wait for confirmation.</Text>}
      {stopStatus === 'stopped' && <Text>Stopped {lastStoppedId}</Text>}
      {stopStatus === 'failed' && <Text>Stop failed; session remains listed until verified otherwise.</Text>}
      {screenReader && ordered.length > 0 &&
        <Text>{formatNumberedSelectionPrompt(ordered.length, true)}{numbered.buffer ? ` ${numbered.buffer}` : ''}</Text>}
      {screenReader && numbered.invalid && <Text>Selection out of range.</Text>}
      <Text>{screenReader ? 'Type a number and Enter to select; s Stop; Escape to close; ? Help.' : '↑↓ Navigate  s Stop  ? Help  q/Esc Close'}</Text>
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
      <SupervisedSessionView loadRows={options.loadRows} onStop={options.onStop} refreshMs={options.refreshMs} />
    </ScreenReaderProvider>,
    { isScreenReaderEnabled: options.screenReader },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
  }
}
