import type { InteractiveSession } from '@robota-sdk/agent-framework';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface ISessionEntry {
  session: InteractiveSession;
  idleTimer: ReturnType<typeof setTimeout>;
}

const store = new Map<string, ISessionEntry>();

function resetIdleTimer(id: string, entry: ISessionEntry): void {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    void destroySession(id);
  }, IDLE_TIMEOUT_MS);
}

export function addSession(id: string, session: InteractiveSession): void {
  const entry: ISessionEntry = {
    session,
    idleTimer: setTimeout(() => {
      void destroySession(id);
    }, IDLE_TIMEOUT_MS),
  };
  store.set(id, entry);
}

export function getSession(id: string): InteractiveSession | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  resetIdleTimer(id, entry);
  return entry.session;
}

export async function destroySession(id: string): Promise<void> {
  const entry = store.get(id);
  if (!entry) return;
  clearTimeout(entry.idleTimer);
  store.delete(id);
  await entry.session.shutdown();
}

export function sessionCount(): number {
  return store.size;
}
