/**
 * Root-element admission: the SPA mounts into `#root` and refuses to start without it, loudly.
 *
 * A missing root is a broken `index.html`, not a state to recover from — mounting into a synthesized
 * element would render a monitor nobody can see. Takes the narrow document surface it reads so the
 * admission is testable without a DOM (issue #2167).
 */
export function requireRootElement(doc: Pick<Document, 'getElementById'>): HTMLElement {
  const rootEl = doc.getElementById('root');
  if (!rootEl) throw new Error('No #root element');
  return rootEl;
}
