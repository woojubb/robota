import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Internal navigation link with prefetching disabled.
 *
 * Under Next.js `output: 'export'` the default `<Link>` prefetch fetches
 * `/<route>.txt?_rsc=…` RSC payloads that a static export never produces → console
 * 404s. Routing all internal links through this wrapper makes the policy
 * one source of truth so a new link can't silently reintroduce the 404s.
 */
export function InternalLink(props: ComponentProps<typeof Link>): React.ReactElement {
  return <Link prefetch={false} {...props} />;
}
