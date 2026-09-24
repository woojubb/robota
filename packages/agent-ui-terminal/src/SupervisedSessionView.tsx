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
  readonly nextLoopAt?: string;
  readonly name?: string;
  readonly cwd?: string;
  readonly problem?: 'invalid-registration';
}

export interface ISupervisedSessionViewProps {
  readonly loadRows: (signal: AbortSignal) => Promise<readonly ISupervisedViewRow[]>;
  readonly onStop?: (id: string) => Promise<void>;
  readonly onStart?: () => Promise<string>;
  readonly filteredByCwd?: boolean;
  readonly filteredByName?: boolean;
  readonly stateFilter?: TGroup;
  readonly refreshMs?: number;
}

const GROUP_ORDER = ['needs-input', 'working', 'idle', 'unknown', 'unverified', 'dead'] as const;
type TGroup = typeof GROUP_ORDER[number];
type TDisplayLine =
  | { readonly kind: 'group'; readonly label: string }
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

function sortedDirectoryRows(rows: readonly ISupervisedViewRow[]): readonly ISupervisedViewRow[] {
  return [...rows].sort((a, b) =>
    (a.cwd === undefined ? 1 : 0) - (b.cwd === undefined ? 1 : 0) ||
    (a.cwd ?? '').localeCompare(b.cwd ?? '') ||
    GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b)) || a.id.localeCompare(b.id));
}

function directoryName(cwd: string): string {
  return cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? cwd;
}

function sameRows(a: readonly ISupervisedViewRow[], b: readonly ISupervisedViewRow[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return other !== undefined && row.id === other.id && row.liveness === other.liveness &&
      row.control === other.control && row.activity === other.activity && row.problem === other.problem &&
      row.nextLoopAt === other.nextLoopAt && row.name === other.name && row.cwd === other.cwd;
  });
}

function loopWaitLabel(nextLoopAt: string, observedAtMs: number): string {
  const remaining = Date.parse(nextLoopAt) - observedAtMs;
  if (!Number.isFinite(remaining)) return '';
  if (remaining <= 0) return 'loop eligible now';
  return remaining < 60_000 ? 'loop eligible in <1m' : `loop eligible in ${Math.ceil(remaining / 60_000)}m`;
}

export default function SupervisedSessionView({
  loadRows,
  onStop,
  onStart,
  filteredByCwd = false,
  filteredByName = false,
  stateFilter,
  refreshMs = 2_000,
}: ISupervisedSessionViewProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const screenReader = useScreenReader();
  const [rows, setRows] = useState<readonly ISupervisedViewRow[]>([]);
  const [observedAtMs, setObservedAtMs] = useState(Date.now);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showHelp, setShowHelp] = useState(false);
  const [groupByDirectory, setGroupByDirectory] = useState(false);
  const [confirmStopId, setConfirmStopId] = useState<string | undefined>();
  const [stopStatus, setStopStatus] = useState<'idle' | 'unavailable' | 'stopping' | 'stopped' | 'failed'>('idle');
  const [lastStoppedId, setLastStoppedId] = useState<string | undefined>();
  const stoppingRef = useRef(false);
  const [startStatus, setStartStatus] = useState<'idle' | 'starting' | 'started' | 'failed'>('idle');
  const [lastStartedId, setLastStartedId] = useState<string | undefined>();
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const ordered = useMemo(() => {
    const filtered = rows.filter((row) => stateFilter === undefined || groupOf(row) === stateFilter);
    return groupByDirectory ? sortedDirectoryRows(filtered) : sortedRows(filtered);
  }, [rows, stateFilter, groupByDirectory]);
  const displayLines = useMemo((): readonly TDisplayLine[] => {
    const lines: TDisplayLine[] = [];
    let previousGroup: string | undefined;
    let directoryNumber = 0;
    ordered.forEach((row, index) => {
      const group = groupByDirectory ? row.cwd ?? 'unverified' : groupOf(row);
      if (group !== previousGroup) {
        const label = groupByDirectory
          ? row.cwd === undefined ? 'Directory: unverified'
            : `Directory ${++directoryNumber}: ${directoryName(row.cwd)} — ${row.cwd}`
          : `${group}:`;
        lines.push({ kind: 'group', label });
      }
      lines.push({ kind: 'row', row, index });
      previousGroup = group;
    });
    return lines;
  }, [ordered, groupByDirectory]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = sortedRows(await loadRows(controller.signal));
        if (!mounted || controller.signal.aborted) return;
        const nowMs = Date.now();
        setRows((previous) => sameRows(previous, next) ? previous : next);
        setObservedAtMs((previous) => next.some((row) => row.nextLoopAt !== undefined &&
          loopWaitLabel(row.nextLoopAt, previous) !== loopWaitLabel(row.nextLoopAt, nowMs)) ? nowMs : previous);
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
    if (startingRef.current && input !== 'q' && !(!screenReader && key.escape) && !(key.ctrl && input === 'c')) return;
    if (confirmStopId !== undefined) {
      if (input === 'n' || key.escape) {
        setConfirmStopId(undefined);
        return;
      }
      if (input === 'y') {
        const row = ordered.find((candidate) => candidate.id === confirmStopId);
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
    if (input === 'g') {
      setGroupByDirectory((value) => !value);
      return;
    }
    if (input === 'n' && onStart !== undefined) {
      startingRef.current = true;
      setStartStatus('starting');
      void Promise.resolve().then(onStart).then((id) => {
        if (!mountedRef.current) return;
        setLastStartedId(id);
        setStartStatus('started');
      }).catch(() => {
        if (mountedRef.current) setStartStatus('failed');
      }).finally(() => { startingRef.current = false; });
      return;
    }
    if (input === 's' && onStop !== undefined) {
      const row = ordered.find((candidate) => candidate.id === selectedId);
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

  const selectedRow = ordered.find((row) => row.id === selectedId);
  const selectedName = status === 'ready' && selectedRow?.liveness === 'alive' &&
    selectedRow.control === 'available' ? selectedRow.name : undefined;
  const selectedLoopStatus = status === 'ready' && selectedRow?.liveness === 'alive' &&
    selectedRow.control === 'available' && selectedRow.activity === 'idle' && selectedRow.nextLoopAt
    ? loopWaitLabel(selectedRow.nextLoopAt, observedAtMs) : '';

  const height = Math.max(8, stdout.rows ?? 24);
  const helpLines = [
    'Keys:',
    screenReader ? 'Number+Enter Select' : '↑/↓ Select',
    's Request stop',
    'g Group state/dir',
    ...(onStart === undefined ? [] : ['n New session']),
    'y Confirm stop',
    'n/Esc Cancel stop',
    'q/Esc/Ctrl+C Close',
    '? Toggle help',
    'Activity ≠ liveness',
    'Idle ≠ attach-ready',
    'Close keeps sessions',
  ];
  // Reserve all fixed chrome plus both possible overflow indicators before choosing row lines.
  const helpVisible = showHelp && confirmStopId === undefined && stopStatus !== 'stopping';
  const fixedLines = 2 + (stateFilter === undefined ? 0 : 1)
    + (status === 'loading' || status === 'unavailable' || (status === 'ready' && ordered.length === 0) ? 1 : 0)
    + (selectedId === undefined ? 0 : 1)
    + (selectedName === undefined ? 0 : 1)
    + (selectedLoopStatus ? 1 : 0)
    + (startStatus === 'idle' ? 0 : 1)
    + (confirmStopId !== undefined ? (screenReader ? 1 : 2) : stopStatus !== 'idle' ? 1 : 0)
    + 1 + (helpVisible ? helpLines.length : 0) + 2;
  const viewport = Math.max(1, height - fixedLines);
  const selectedLine = Math.max(0, displayLines.findIndex((line) => line.kind === 'row' && line.row.id === selectedId));
  const start = Math.min(Math.max(0, selectedLine - Math.floor(viewport / 2)), Math.max(0, displayLines.length - viewport));
  const visible = screenReader ? displayLines : displayLines.slice(start, start + viewport);
  const chromeWrap = screenReader ? {} : { wrap: 'truncate-end' as const };
  const footer = stopStatus === 'stopping' ? 'Stop in progress; wait for result.'
    : confirmStopId !== undefined ? 'Confirm stop or cancel before closing.'
      : screenReader ? `Type a number and Enter to select; s Stop;${onStart ? ' n New;' : ''} g Group; Escape to close; ? Help.`
        : `↑↓ Navigate  s Stop${onStart ? '  n New' : ''}  g Group  ? Help  q/Esc Close`;
  return (
    <Box flexDirection="column" {...(screenReader ? {} : { height })}>
      <Text {...chromeWrap}>
        {filteredByCwd ? 'Background sessions in selected directory' : 'Background sessions across projects'}
        {filteredByName ? ' · name filter active' : ''}
      </Text>
      <Text {...chromeWrap}>{ordered.length} supervised session(s). Foreground peers and saved records are separate.</Text>
      {stateFilter !== undefined && <Text {...chromeWrap}>State: {stateFilter}</Text>}
      {status === 'loading' && <Text {...chromeWrap}>Loading supervised sessions...</Text>}
      {status === 'unavailable' && <Text {...chromeWrap}>Supervised session discovery unavailable; last verified rows remain below.</Text>}
      {status === 'ready' && ordered.length === 0 && <Text {...chromeWrap}>No supervised sessions.</Text>}
      {start > 0 && !screenReader && <Text>{start} more above</Text>}
      {visible.map((line) => line.kind === 'group'
        ? <Text key={`group-${line.label}`} {...chromeWrap}>{line.label}</Text>
        : <Text key={`row-${line.row.id}`} {...(screenReader ? {} : { wrap: 'truncate-end' as const })}>
          {screenReader ? numberedRowPrefix(line.index) : line.row.id === selectedId ? '> ' : '  '}
          {line.row.name && line.row.liveness === 'alive' && line.row.control === 'available'
            ? screenReader
              ? `${line.row.name} (${line.row.id})`
              : `${Array.from(line.row.name).slice(0, 24).join('')}${Array.from(line.row.name).length > 24 ? '…' : ''} [${line.row.id.slice(-8)}]`
            : line.row.id}  activity {line.row.activity}  liveness {line.row.liveness}  control {line.row.control}
          {status === 'ready' && line.row.liveness === 'alive' && line.row.control === 'available' &&
            line.row.activity === 'idle' && line.row.nextLoopAt
            ? `  ${loopWaitLabel(line.row.nextLoopAt, observedAtMs)}` : ''}
          {line.row.problem ? `  ${line.row.problem}` : ''}
        </Text>)}
      {!screenReader && start + visible.length < displayLines.length &&
        <Text>{displayLines.length - start - visible.length} more below</Text>}
      {selectedId !== undefined && <Text {...chromeWrap}>Selected {selectedId}</Text>}
      {selectedName !== undefined && <Text {...chromeWrap}>Name: {selectedName}</Text>}
      {selectedLoopStatus && <Text {...chromeWrap}>{selectedLoopStatus}</Text>}
      {startStatus === 'starting' && <Text {...chromeWrap}>Starting a background session...</Text>}
      {startStatus === 'started' && <Text {...chromeWrap}>Started {lastStartedId}{filteredByName || stateFilter !== undefined ? ' (may be hidden by filter)' : ''}</Text>}
      {startStatus === 'failed' && <Text {...chromeWrap}>Start failed; check workspace trust or run session start --background for details.</Text>}
      {confirmStopId !== undefined && (screenReader
        ? <Text>Stop {confirmStopId}? y Yes / n No</Text>
        : <>
          <Text {...chromeWrap}>Stop …{confirmStopId.slice(-8)}?</Text>
          <Text {...chromeWrap}>y Yes / n No</Text>
        </>)}
      {confirmStopId === undefined && stopStatus === 'unavailable' &&
        <Text {...chromeWrap}>This session cannot be stopped from the view.</Text>}
      {stopStatus === 'stopping' && <Text {...chromeWrap}>Stopping selected session; wait for confirmation.</Text>}
      {stopStatus === 'stopped' && <Text {...chromeWrap}>Stopped {lastStoppedId}</Text>}
      {stopStatus === 'failed' && <Text {...chromeWrap}>Stop failed; session remains listed until verified otherwise.</Text>}
      {screenReader && ordered.length > 0 && confirmStopId === undefined && stopStatus !== 'stopping' &&
        <Text>{formatNumberedSelectionPrompt(ordered.length, true)}{numbered.buffer ? ` ${numbered.buffer}` : ''}</Text>}
      {screenReader && numbered.invalid && <Text>Selection out of range.</Text>}
      <Text {...chromeWrap}>{footer}</Text>
      {helpVisible && helpLines.map((line) => <Text key={line} {...chromeWrap}>{line}</Text>)}
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
      <SupervisedSessionView loadRows={options.loadRows} onStop={options.onStop}
        onStart={options.onStart}
        filteredByCwd={options.filteredByCwd} filteredByName={options.filteredByName}
        stateFilter={options.stateFilter} refreshMs={options.refreshMs} />
    </ScreenReaderProvider>,
    { isScreenReaderEnabled: options.screenReader, exitOnCtrlC: false },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
  }
}
