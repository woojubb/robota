'use client';

import dynamic from 'next/dynamic';

const PlaygroundDemo = dynamic(
  () => import('@robota-sdk/agent-playground').then((m) => ({ default: m.PlaygroundDemo })),
  { ssr: false, loading: () => <div className="p-6 text-sm text-gray-500">Loading Demo...</div> },
);

export default function PlaygroundDemoPage() {
  return <PlaygroundDemo />;
}
