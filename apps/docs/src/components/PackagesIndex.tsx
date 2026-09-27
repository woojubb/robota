import type { ReactElement } from 'react';

import type { IPackageIndexEntry } from '@/lib/packages-index';

/** The `/packages/` landing page: every package with docs, generated from the repo at build time. */
export function PackagesIndex({
  locale,
  entries,
}: {
  locale: string;
  entries: IPackageIndexEntry[];
}): ReactElement {
  return (
    <div>
      <h1>Packages</h1>
      <p>
        Every <code>@robota-sdk/*</code> package with its own documentation. Each page links to the
        package&apos;s SPEC — its contract, invariants and design decisions. Packages marked
        <em> internal</em> are part of the monorepo but not published to npm.
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.dir}>
            <a href={`/${locale}/packages/${entry.dir}/`}>
              <code>{entry.name}</code>
            </a>
            {entry.internal ? <em> (internal)</em> : null}
            {entry.summary ? <> — {entry.summary}</> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
