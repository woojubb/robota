import { ArrowUp, Gauge, Shield, Sparkles, Square, Target } from 'lucide-react';
import { useEffect, useState } from 'react';

import { commandMenuFor } from '../hooks/command-menu.js';

import type { TCommandCatalog, TSessionStatus } from '../hooks/session-client-types.js';

/**
 * The composer — the control centre, as desktop agent apps place it: the message box, a `/` menu of
 * the commands and skills the session offers, and a status row (model, permission mode, effort,
 * context). The row's controls run the session's own commands (`/provider`, `/mode`, `/effort`), so a
 * setting changes through the one path every client shares.
 */
export function Composer({
  onSubmit,
  onCommand,
  catalog,
  status,
}: {
  onSubmit: (prompt: string) => void;
  onCommand: (name: string) => void;
  catalog: TCommandCatalog | null;
  status: TSessionStatus | null;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const menu = dismissed ? null : commandMenuFor(catalog, draft);
  useEffect(() => {
    setSelected(0);
    setDismissed(false);
  }, [draft]);

  const submit = (): void => {
    const prompt = draft.trim();
    if (!prompt) return;
    onSubmit(prompt);
    setDraft('');
  };
  /** Complete the highlighted name; a draft that already names it is sent instead. */
  const acceptMenu = (): boolean => {
    const item = menu?.[selected];
    if (!item || draft === `/${item.name}`) return false;
    setDraft(`/${item.name} `);
    return true;
  };

  return (
    <div className="relative flex-shrink-0">
      {menu && (
        <div
          role="listbox"
          aria-label="commands"
          className="gui-rise absolute bottom-full left-0 right-0 mb-2 max-h-[320px] overflow-y-auto rounded-2xl bg-popover p-1.5 shadow-2xl shadow-black/35"
        >
          {menu.map((item, index) => {
            const runsElsewhere = item.runsIn ? runsInDescription(item.runsIn) : undefined;
            return (
              <button
                key={`${item.kind}:${item.name}`}
                type="button"
                role="option"
                aria-selected={index === selected}
                aria-description={runsElsewhere}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDraft(`/${item.name} `);
                }}
                className={`flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left text-[14px] ${
                  index === selected ? 'bg-hover' : ''
                }`}
              >
                {/* A command that runs elsewhere dims its name and description by text colour only —
                    an opacity on the row would also fade its badge and the selected highlight. */}
                <span
                  className={`flex-shrink-0 font-mono text-[13.5px] ${runsElsewhere ? 'text-subtle' : 'text-foreground'}`}
                >
                  /{item.name}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${runsElsewhere ? 'text-subtle' : 'text-muted-foreground'}`}
                >
                  {item.description}
                </span>
                {item.kind === 'skill' && <MenuBadge label="skill" />}
                {item.runsIn && (
                  <MenuBadge label={item.runsIn.join(' · ') || 'client'} title={runsElsewhere} />
                )}
              </button>
            );
          })}
        </div>
      )}
      <form
        className="rounded-[22px] bg-card px-2.5 pb-2 pt-2.5 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] transition-shadow focus-within:ring-2 focus-within:ring-ring"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="message"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (menu) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setSelected((index) => (index + step + menu.length) % menu.length);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDismissed(true);
                return;
              }
              if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && acceptMenu()) {
                e.preventDefault();
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask robota anything — type / for commands"
          className="block max-h-[220px] min-h-[48px] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-relaxed text-foreground [field-sizing:content] focus:outline-none"
        />
        <div className="mt-1 flex items-center gap-1">
          <StatusRow status={status} onCommand={onCommand} />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-85 disabled:bg-raised disabled:text-subtle"
          >
            <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />
            <span className="sr-only">Send</span>
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Where a command the session does not run is run instead. The GUI runs no client command, so its
 * row stays offered — choosing it inserts the command and the session answers with its refusal —
 * but says where it works.
 */
function runsInDescription(runsIn: readonly string[]): string {
  return `Runs in the robota ${runsIn.join(' or ') || 'client'}`;
}

/** Solid muted text, never an opacity, so a small badge stays legible on a plain or selected row. */
function MenuBadge({ label, title }: { label: string; title?: string }): React.ReactElement {
  return (
    <span
      title={title}
      className="flex-shrink-0 rounded-md bg-raised px-1.5 py-px text-[12px] text-muted-foreground"
    >
      {label}
    </span>
  );
}

/**
 * The goal being pursued (`/goal`), above the composer while it is active — the objective, how far
 * the turn budget has gone, and a way to stop it (`/goal cancel`).
 */
export function GoalBar({
  status,
  onStop,
}: {
  status: TSessionStatus | null;
  onStop: () => void;
}): React.ReactElement | null {
  const goal = status?.goal;
  if (!goal || goal.status !== 'active') return null;
  const progress = goal.maxIterations > 0 ? Math.min(1, goal.iterations / goal.maxIterations) : 0;
  return (
    <div
      role="status"
      aria-label="goal"
      className="gui-rise relative flex flex-shrink-0 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 py-2.5 text-[14px]"
    >
      <Target size={16} strokeWidth={1.75} className="flex-shrink-0 text-accent" />
      <span className="flex-shrink-0 font-medium text-foreground">Goal</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{goal.objective}</span>
      <span className="flex-shrink-0 text-[13px] tabular-nums text-subtle">
        {goal.iterations}/{goal.maxIterations}
      </span>
      <button
        type="button"
        aria-label="Stop goal"
        onClick={onStop}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Square size={11} fill="currentColor" aria-hidden="true" />
        Stop
      </button>
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-[2px] bg-accent/70 transition-[width]"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

/** Model · mode · effort, each opening its picker, and the context the conversation fills. */
function StatusRow({
  status,
  onCommand,
}: {
  status: TSessionStatus | null;
  onCommand: (name: string) => void;
}): React.ReactElement {
  const chip = (
    label: string,
    value: string,
    command: string,
    icon: React.ReactElement,
  ): React.ReactElement => (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      title={`Change ${label}`}
      onClick={() => onCommand(command)}
      className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
    >
      {icon}
      <span className="truncate">{value}</span>
    </button>
  );
  const used = status ? Math.round(status.context.usedPercentage) : null;
  const iconProps = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      {status ? (
        <>
          {chip('mode', status.permissionMode, 'mode', <Shield {...iconProps} />)}
          <span className="ml-auto" />
          {chip('model', status.model, 'provider', <Sparkles {...iconProps} />)}
          {chip('effort', status.effort, 'effort', <Gauge {...iconProps} />)}
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
