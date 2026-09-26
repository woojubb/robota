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
    <div className="relative flex-shrink-0 border-t border-border/70 bg-card/25 px-3 pb-2 pt-2.5">
      {menu && (
        <div
          role="listbox"
          aria-label="commands"
          className="gui-rise absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-border/70 bg-card shadow-lg shadow-black/40"
        >
          {menu.map((item, index) => (
            <button
              key={`${item.kind}:${item.name}`}
              type="button"
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                setDraft(`/${item.name} `);
              }}
              className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left font-mono text-[12px] ${
                index === selected ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className="flex-shrink-0 text-foreground/90">/{item.name}</span>
              <span className="min-w-0 flex-1 truncate opacity-70">{item.description}</span>
              {item.kind === 'skill' && (
                <span className="flex-shrink-0 rounded border border-border/60 px-1 text-[10px] uppercase tracking-wider opacity-60">
                  skill
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2"
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
          placeholder="Message the agent…  ( / for commands )"
          className="max-h-[140px] min-h-[38px] flex-1 resize-none rounded-xl border border-border/70 bg-background/60 px-3.5 py-2.5 text-sm leading-relaxed text-foreground transition-all placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="h-[38px] rounded-xl border border-border/70 px-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send
        </button>
      </form>
      <StatusRow status={status} onCommand={onCommand} />
    </div>
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
  return (
    <div
      role="status"
      aria-label="goal"
      className="gui-rise mx-3 mt-2 flex flex-shrink-0 items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 font-mono text-[12px]"
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-primary" />
      <span className="text-muted-foreground">goal</span>
      <span className="min-w-0 flex-1 truncate text-foreground/90">{goal.objective}</span>
      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
        {goal.iterations}/{goal.maxIterations}
      </span>
      <button
        type="button"
        aria-label="Stop goal"
        onClick={onStop}
        className="flex-shrink-0 rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-rose-400/50 hover:text-rose-200"
      >
        Stop
      </button>
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
  const chip = (label: string, value: string, command: string): React.ReactElement => (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      onClick={() => onCommand(command)}
      className="rounded-md px-1.5 py-0.5 hover:bg-card/80 hover:text-foreground"
    >
      <span className="text-muted-foreground/50">{label} </span>
      {value}
    </button>
  );
  const used = status ? Math.round(status.context.usedPercentage) : null;
  return (
    <div className="mt-1.5 flex items-center gap-1 px-0.5 font-mono text-[10.5px] text-muted-foreground/80">
      {status ? (
        <>
          {chip('model', status.model, 'provider')}
          {chip('mode', status.permissionMode, 'mode')}
          {chip('effort', status.effort, 'effort')}
        </>
      ) : (
        <span className="px-1.5 text-muted-foreground/40">…</span>
      )}
      <span className="ml-auto flex items-center gap-1.5 px-1" aria-label={`context ${used ?? 0}% used`}>
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
  const tone = percent >= 80 ? 'stroke-amber-400' : 'stroke-primary/80';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} className="fill-none stroke-border" strokeWidth="2" />
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
