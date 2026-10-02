import type { ReactElement } from 'react';
import { RemoteSurface } from './RemoteSurface';
import { loadWebProductConfig } from '../../lib/product-config';

/** Resolve on the server; only the allowlisted public projection enters the client boundary. */
export default function RemotePage(): ReactElement {
  const product = loadWebProductConfig({ ...process.env });
  return <RemoteSurface product={product} />;
}
