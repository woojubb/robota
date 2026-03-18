'use client';

import dynamic from 'next/dynamic';

const PlaygroundApp = dynamic(
  () => import('@robota-sdk/agent-playground').then((m) => ({ default: m.PlaygroundApp })),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-500">Loading Playground...</div>,
  },
);

export default function PlaygroundPage() {
  return <PlaygroundApp />;
}
