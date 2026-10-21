import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SiteAnalytics } from './SiteAnalytics';

// Reuse the workspace's browser fixture, as the product-site regression tests do.
const uiRequire = createRequire(new URL('../../../../packages/agent-ui-web/package.json', import.meta.url));
const { JSDOM } = uiRequire('jsdom');
const navigation = vi.hoisted(() => ({ pathname: '/', ready: () => {} }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/script', () => ({ default: ({ src, onReady }: { src: string; onReady: () => void }) => {
  navigation.ready = onReady;
  return <script src={src} />;
} }));
let dom: InstanceType<typeof JSDOM>;
let root: Root;
function commands(): unknown[][] {
  return ((window as Window & { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((command) => Array.from(command));
}
function views() { return commands().filter((command) => command[0] === 'event' && command[1] === 'page_view'); }
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(() => { button!.click(); });
}
async function render(id: string | undefined = 'G-TEST123') {
  await act(() => root.render(<SiteAnalytics measurementId={id} locale="en" />));
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head><title>Example home</title></head><body><div id="root"></div></body></html>', { url: 'https://example.test/?email=private#secret' });
  for (const key of ['window', 'document', 'location', 'localStorage']) vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  navigation.pathname = '/';
});
afterEach(async () => { await act(() => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); });

it('loads nothing before consent or after rejection, and remembers rejection', async () => {
  await render();
  expect(document.querySelector('script')).toBeNull();
  expect(commands()).toHaveLength(0);
  await click('Reject');
  expect(localStorage.getItem('site-analytics-consent-v1')).toBe('rejected');
  expect(document.querySelector('script')).toBeNull();
  expect(views()).toHaveLength(0);
});

it('queues valid gtag commands and one sanitized view per pathname only after the script is ready', async () => {
  await render(); await click('Accept');
  expect(document.querySelectorAll('script')).toHaveLength(1);
  expect(views()).toHaveLength(0);
  const layer = (window as unknown as { dataLayer: unknown[] }).dataLayer;
  expect(Object.prototype.toString.call(layer[0])).toBe('[object Arguments]');
  expect(commands().find((command) => command[0] === 'config')?.[2]).toMatchObject({ send_page_view: false, allow_google_signals: false });
  await act(() => navigation.ready());
  expect(views()).toHaveLength(1);
  expect(views()[0][2]).toMatchObject({ page_location: 'https://example.test/' });
  await render();
  expect(views()).toHaveLength(1);
  navigation.pathname = '/en/roadmap';
  await render();
  expect(views()).toHaveLength(2);
  expect(views()[1][2]).toMatchObject({ page_location: 'https://example.test/en/roadmap' });
});

it('restores acceptance and disables collection immediately when the visitor withdraws it', async () => {
  localStorage.setItem('site-analytics-consent-v1', 'accepted');
  await render(); await act(() => navigation.ready());
  expect(views()).toHaveLength(1);
  await click('Analytics cookie settings'); await click('Reject');
  expect((window as unknown as Record<string, unknown>)['ga-disable-G-TEST123']).toBe(true);
  navigation.pathname = '/ko'; await render();
  expect(views()).toHaveLength(1);
});

it('omits all analytics UI and scripts without a valid configured stream', async () => {
  await render(''); expect(document.body.textContent).toBe('');
  await render('bad-id'); expect(document.querySelector('script')).toBeNull();
});
