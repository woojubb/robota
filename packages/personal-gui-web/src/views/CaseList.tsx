import { useEffect, useState } from 'react';

import { caseRequest } from './case-request.js';
import { Button, Notice, ViewFrame, errorText, when } from './ui.js';

import type { ICaseView, IPersonalApi } from '../api.js';

const REFRESH_MS = 3_000;

/** Cases stay reachable even after their feed cards are dismissed. */
export function CaseList({
  api,
  onBack,
  onOpenCase,
}: {
  readonly api: IPersonalApi;
  readonly onBack: () => void;
  readonly onOpenCase: (caseId: string) => void;
}): React.ReactElement {
  const [cases, setCases] = useState<readonly ICaseView[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let requested = 0;
    let applied = 0;
    const load = async (): Promise<void> => {
      const ticket = ++requested;
      try {
        const next = await caseRequest((signal) => api.cases(signal));
        if (!active || ticket <= applied) return;
        applied = ticket;
        setCases(next);
        setError(undefined);
      } catch (caught) {
        if (!active || ticket <= applied) return;
        applied = ticket;
        setError(errorText(caught));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);
  return (
    <ViewFrame title="Cases" actions={<Button onClick={onBack}>Back to feed</Button>}>
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {cases === undefined && error === undefined && <Notice>Loading…</Notice>}
      {cases?.length === 0 && <Notice>No cases yet.</Notice>}
      <ul className="flex max-w-3xl flex-col gap-2 p-4" aria-label="Cases">
        {(cases ?? []).map((item) => (
          <li key={item.id} className="rounded-lg border border-border p-3">
            <h2 className="text-[14px] font-semibold">{item.title}</h2>
            <p className="text-[12.5px] text-muted-foreground">
              {item.state === 'open' ? 'Open' : 'Closed'} · updated {when(item.updatedAt)}
            </p>
            <Button
              label={`Open case: ${item.title} (${item.id})`}
              onClick={() => onOpenCase(item.id)}
            >
              Open case
            </Button>
          </li>
        ))}
      </ul>
    </ViewFrame>
  );
}
