'use client';

import dynamic from 'next/dynamic';

const SessionMonitor = dynamic(
  () => import('@robota-sdk/agent-web/client').then((m) => ({ default: m.SessionMonitor })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs font-mono text-muted-foreground/40">
        Loading Monitor…
      </div>
    ),
  },
);

export function MonitorClient() {
  return (
    <SessionMonitor
      defaultUrl={process.env.NEXT_PUBLIC_CLI_WS_URL ?? 'ws://localhost:7070'}
      className="h-full"
    />
  );
}
