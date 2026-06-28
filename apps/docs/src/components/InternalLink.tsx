import Link from 'next/link';
import type { ComponentProps, ReactElement } from 'react';

/**
 * Internal navigation link with `prefetch={false}` baked in (DOCS-003).
 *
 * This site is a Next.js static export (`output: 'export'`): the default `<Link>` prefetch
 * fetches RSC `/<route>.txt?_rsc=` payloads that don't exist in a static export, producing
 * console 404s. Centralizing the policy here (mirrors `apps/www`) keeps a new link from
 * silently regressing to RSC-prefetch 404s.
 */
export function InternalLink(props: ComponentProps<typeof Link>): ReactElement {
  return <Link prefetch={false} {...props} />;
}
