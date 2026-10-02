'use client';

import dynamic from 'next/dynamic';
import { useMemo, type ReactElement } from 'react';
import { createIdentityContext } from '@robota-sdk/agent-remote-pairing';
import type { IPublicProductConfig } from '@robota-sdk/product-config';

const RemoteClient = dynamic(
  () => import('@robota-sdk/agent-transport-webrtc-web/client').then((module) => ({ default: module.RemoteClient })),
  { ssr: false, loading: () => <main className="p-6 text-sm text-gray-500">Loading remote client…</main> },
);

export function RemoteSurface({ product }: { product: IPublicProductConfig }): ReactElement {
  const cryptoContext = useMemo(() => createIdentityContext(product.crypto.namespace), [product.crypto.namespace]);
  return <div className="h-screen w-screen overflow-hidden"><RemoteClient product={product} cryptoContext={cryptoContext} credentialDatabase={product.storage.browserCredentialDatabase} /></div>;
}
