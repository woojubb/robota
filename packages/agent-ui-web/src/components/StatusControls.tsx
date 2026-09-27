'use client';

import { Gauge, Shield, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';

import { PopupMenu } from './PopupMenu.js';

import type { IPopupMenuItem, IPopupMenuSection } from './PopupMenu.js';
import type { TCommandCatalog, TModelListSnapshot, TSessionStatus } from '../hooks/session-client-types.js';

/**
 * #3282 §2 (part 2) — the plain label for each effort selection. Kept in step with
 * `EFFORT_LEVEL_LABELS` in `packages/agent-framework/src/effort/effort-resolution.ts` (which
 * `agent-command`'s `/effort` re-exports and reports as its own outcome text) — this package cannot
 * import that one directly (it is a Node-side package this browser bundle does not depend on), so the
 * values are restated here. `Record<TSessionStatus['effort'], …>` still keeps this exhaustive against
 * the real wire type: an effort value added there without a label here is a compile error.
 */
const EFFORT_LEVEL_LABELS: Readonly<Record<TSessionStatus['effort'], string>> = {
  auto: 'Auto',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};

/** The primary row (#3282 §2 design point 4); the rest sit under "More". */
const EFFORT_PRIMARY: readonly TSessionStatus['effort'][] = ['auto', 'low', 'medium', 'high'];
const EFFORT_MORE: readonly TSessionStatus['effort'][] = ['none', 'minimal', 'xhigh', 'max'];

/** The `mode` command's subcommand entries (plain label + description per mode), from the catalog. */
function modeSubcommands(
  catalog: TCommandCatalog | null,
): readonly { name: string; displayName?: string; description: string }[] {
  return catalog?.commands.find((command) => command.name === 'mode')?.subcommands ?? [];
}

/** The current mode's plain label, falling back to the raw id before the catalog has loaded. */
function modeLabel(catalog: TCommandCatalog | null, mode: string): string {
  return modeSubcommands(catalog).find((sub) => sub.name === mode)?.displayName ?? mode;
}

const CHIP_CLASS =
  'flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent';
const CHIP_WARNING_CLASS = 'text-warning hover:text-warning';

/** One status chip that opens a `PopupMenu` HIG pop-up beneath it (#3282 §2). */
function StatusChip({
  chipLabel,
  value,
  icon,
  connected,
  warning = false,
  menuLabel,
  sections,
  onOpen,
}: {
  chipLabel: string;
  value: string;
  icon: React.ReactElement;
  connected: boolean;
  warning?: boolean;
  menuLabel: string;
  sections: readonly IPopupMenuSection[];
  /** Called just before the menu opens — e.g. to (re)fetch the model list. */
  onOpen?: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${chipLabel}: ${value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        // #3289 §2: below `md` the value text is hidden (icon-only) — the tooltip is where it stays
        // reachable on hover and keyboard focus, so it always carries the value, not just "Change X".
        title={connected ? `${chipLabel}: ${value}` : 'Reconnecting…'}
        disabled={!connected}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        className={`${CHIP_CLASS} ${warning ? CHIP_WARNING_CLASS : ''}`}
      >
        {icon}
        {/* #3289 §2: below `md` (the same breakpoint the session-list sheet uses) the chip collapses
            to its icon alone — never a truncated fragment ("d…", "claude-…") — the value stays
            reachable via the tooltip above and the accessible name either way. */}
        <span className="hidden truncate md:inline">{value}</span>
      </button>
      {open ? (
        <PopupMenu
          label={menuLabel}
          sections={sections}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

const ICON_PROPS = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;

/**
 * Model · mode · effort, each a pop-up menu (#3282 §2), and the context the conversation fills.
 * Every menu applies its choice through the same command wire path the equivalent typed slash
 * command uses — `onSilentCommand` — so `/model <id>`, `/mode <name>` and `/effort <value>` and a
 * click in these menus can never drift apart; the control's own chip label (fed by the session's next
 * `session_status`) confirms the change instead of a conversation card.
 */
export function StatusRow({
  status,
  catalog,
  modelList,
  onRequestModelList,
  onCommand,
  onSilentCommand,
  connected,
}: {
  status: TSessionStatus | null;
  catalog: TCommandCatalog | null;
  modelList: TModelListSnapshot | null;
  onRequestModelList: () => void;
  /** The existing (unchanged) bare-command path — used only by "Manage providers…" today. */
  onCommand: (name: string, args?: string) => void;
  /** Applies a model/mode/effort choice without a conversation card (see the module doc). */
  onSilentCommand: (name: string, args?: string) => void;
  connected: boolean;
}): React.ReactElement {
  const used = status ? Math.round(status.context.usedPercentage) : null;

  const modelSections: IPopupMenuSection[] = [
    ...(modelList?.groups ?? []).map((group) => ({
      heading: group.providerLabel,
      items: group.models.map(
        (model): IPopupMenuItem => ({
          key: model.id,
          label: model.label,
          checked: model.id === modelList?.currentModel && group.profileName === modelList?.currentProfile,
          onSelect: () => onSilentCommand('model', model.id),
        }),
      ),
    })),
    {
      items: [
        {
          key: 'manage-providers',
          label: 'Manage providers…',
          kind: 'action',
          // #3282 §2: opens the existing (server-driven) profile flow, unchanged — moves to Settings
          // later. Never silenced: Switch/Edit/Test/Duplicate/Delete each already say their own
          // outcome, which is not redundant with a chip label the way a plain model/mode/effort
          // apply's outcome is.
          onSelect: () => onCommand('provider'),
        },
      ],
    },
  ];

  const modeSections: IPopupMenuSection[] = [
    {
      items: modeSubcommands(catalog).map(
        (sub): IPopupMenuItem => ({
          key: sub.name,
          label: sub.displayName ?? sub.name,
          description: sub.description,
          checked: sub.name === status?.permissionMode,
          // #3282 §2: every mode but "Skip all checks" applies at once — the same seam the request
          // for that mode alone (still applied directly, unconfirmed, pending #3282 §2's bypass
          // confirmation — tracked separately, see the PR description) uses `onCommand` instead so
          // its outcome (currently the only mode with no confirmation) keeps its own card.
          onSelect:
            sub.name === 'bypassPermissions'
              ? () => onCommand('mode', sub.name)
              : () => onSilentCommand('mode', sub.name),
        }),
      ),
    },
  ];

  const effortSections: IPopupMenuSection[] = [
    {
      items: EFFORT_PRIMARY.map(
        (value): IPopupMenuItem => ({
          key: value,
          label: EFFORT_LEVEL_LABELS[value],
          checked: value === status?.effort,
          onSelect: () => onSilentCommand('effort', value),
        }),
      ),
    },
    {
      heading: 'More',
      items: EFFORT_MORE.map(
        (value): IPopupMenuItem => ({
          key: value,
          label: EFFORT_LEVEL_LABELS[value],
          checked: value === status?.effort,
          onSelect: () => onSilentCommand('effort', value),
        }),
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      {status ? (
        <>
          <StatusChip
            chipLabel="mode"
            value={modeLabel(catalog, status.permissionMode)}
            icon={<Shield {...ICON_PROPS} />}
            connected={connected}
            warning={status.permissionMode === 'bypassPermissions'}
            menuLabel="Mode"
            sections={modeSections}
          />
          <span className="ml-auto" />
          <StatusChip
            chipLabel="model"
            value={status.model}
            icon={<Sparkles {...ICON_PROPS} />}
            connected={connected}
            menuLabel="Model"
            sections={modelSections}
            onOpen={onRequestModelList}
          />
          <StatusChip
            chipLabel="effort"
            value={EFFORT_LEVEL_LABELS[status.effort]}
            icon={<Gauge {...ICON_PROPS} />}
            connected={connected}
            menuLabel="Effort"
            sections={effortSections}
          />
        </>
      ) : (
        <span className="ml-auto px-2 text-[13px] text-subtle">…</span>
      )}
      <span
        className="flex items-center gap-1.5 px-1.5 text-[12.5px] tabular-nums text-subtle"
        title="Context used"
        aria-label={`context ${used ?? 0}% used`}
      >
        <ContextRing percent={used ?? 0} />
        {used === null ? '' : `${used}%`}
      </span>
    </div>
  );
}

function ContextRing({ percent }: { percent: number }): React.ReactElement {
  const r = 5;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(100, Math.max(0, percent)) / 100;
  const tone = percent >= 80 ? 'stroke-warning' : 'stroke-muted-foreground';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} className="fill-none stroke-raised" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        className={`fill-none ${tone}`}
        strokeWidth="2"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}
