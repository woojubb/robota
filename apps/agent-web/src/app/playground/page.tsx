'use client';

import dynamic from 'next/dynamic';

import type { ReactElement } from 'react';

const PlaygroundApp = dynamic(
  () => import('@robota-sdk/agent-playground/client').then((m) => ({ default: m.PlaygroundApp })),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-500">Loading Playground...</div>,
  },
);

export default function PlaygroundPage(): ReactElement {
  return <PlaygroundApp defaultServerUrl={process.env.NEXT_PUBLIC_PLAYGROUND_WS_URL} />;
}
