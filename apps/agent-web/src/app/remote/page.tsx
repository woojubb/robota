'use client';

import dynamic from 'next/dynamic';

import type { ReactElement } from 'react';

/**
 * GUI-007 — the hosted Stage-D browser remote client (REMOTE-009), relocated here from the retired standalone
 * web-monitor SPA. Connection inputs come from THIS page's URL — the relay from `?relay=`, the
 * rendezvous + secret from the `#` fragment (the secret never leaves the browser). ssr:false because it reads
 * `window.location` + opens a WebRTC peer.
 */
const RemoteClient = dynamic(
  () =>
    import('@robota-sdk/agent-transport-webrtc-web/client').then((m) => ({
      default: m.RemoteClient,
    })),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-500">Loading remote client…</div>,
  },
);

export default function RemotePage(): ReactElement {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <RemoteClient />
    </div>
  );
}
