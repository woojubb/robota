'use client';

import dynamic from 'next/dynamic';

const SessionMonitor = dynamic(
  () => import('@robota-sdk/agent-web/client').then((m) => ({ default: m.SessionMonitor })),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-500">Loading Monitor...</div>,
  },
);

export default function MonitorPage() {
  return (
    <SessionMonitor
      defaultUrl={process.env.NEXT_PUBLIC_CLI_WS_URL ?? 'ws://localhost:7070'}
      className="h-full"
    />
  );
}
