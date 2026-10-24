'use client';

import en from '../messages/errors/en.json';
import ko from '../messages/errors/ko.json';

/** Keep recovery usable even when a route chunk or a root layout fails to load. */
export default function GlobalError() {
  return <html lang="en"><body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '3rem 1.5rem', lineHeight: 1.6 }}>
    <main style={{ maxWidth: '40rem', margin: '0 auto' }}>
      <h1>{en.title}</h1>
      <p>{en.body}</p>
      <div lang="ko"><h2>{ko.title}</h2><p>{ko.body}</p></div>
      <button type="button" onClick={() => window.location.reload()} style={{ padding: '0.75rem 1rem', font: 'inherit', cursor: 'pointer' }}>{en.reload} / <span lang="ko">{ko.reload}</span></button>
      <p><a href="/">{en.home}</a> · <a href="/ko" lang="ko">{ko.home}</a></p>
    </main>
  </body></html>;
}
