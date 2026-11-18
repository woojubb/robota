/**
 * Notifications while the page is closed: a worker in the page shows what the agent pushes, and the
 * browser's own push service carries it there. Everything here runs from a press of a button in
 * Settings, never when the page loads, because the browser's question about notifying is only asked
 * for a deliberate press. The page hands the browser's subscription to the agent and checks whether
 * it is still kept; it never displays a push address or key.
 */
import { ApiError } from './api.js';
import type { IPersonalApi, IPushStatusView } from './api.js';

/** A stable registration that does not control the authenticated page or another app's pages. */
export const PUSH_WORKER = '/push-worker.js';
export const PUSH_SCOPE = '/__robota_personal_push__/';
const WORKER_READY_MS = 15_000;

/** Whether this browser can take a push: a worker, the push manager and notifications, on a secure page. */
export function pushSupported(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      navigator.serviceWorker !== undefined &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      typeof Notification !== 'undefined'
    );
  } catch {
    // allow-fallback: a browser that refuses to say has no push to offer.
    return false;
  }
}

/** The bytes of a URL-safe base64 key. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const standard = key.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function sameBytes(left: ArrayBuffer | null, right: Uint8Array): boolean {
  if (left === null) return false;
  const bytes = new Uint8Array(left);
  return bytes.length === right.length && bytes.every((value, index) => value === right[index]);
}

function isOwnRegistration(registration: ServiceWorkerRegistration | undefined): boolean {
  const own = new URL(PUSH_SCOPE, window.location.origin).href;
  const script = (registration?.active ?? registration?.waiting ?? registration?.installing)
    ?.scriptURL;
  return registration?.scope === own && script === new URL(PUSH_WORKER, own).href;
}

function isLegacyRegistration(registration: ServiceWorkerRegistration): boolean {
  const script = (registration.active ?? registration.waiting ?? registration.installing)
    ?.scriptURL;
  const scope = new URL(registration.scope);
  return (
    scope.origin === window.location.origin &&
    /^\/[A-Za-z0-9_-]{32}\/$/u.test(scope.pathname) &&
    script === new URL('push-worker.js', scope).href
  );
}

/** Whether this browser still holds a subscription from an older session path. */
export async function hasLegacySubscription(): Promise<boolean> {
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    if (!isLegacyRegistration(registration)) continue;
    try {
      if ((await registration.pushManager.getSubscription()) !== null) return true;
    } catch {
      // An unreadable earlier worker may still hold a subscription.
      return true;
    }
  }
  return false;
}

/** The subscriptions held by this browser's older workers, for an atomic replacement at the agent. */
async function legacyEndpoints(): Promise<readonly string[]> {
  const endpoints: string[] = [];
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    if (!isLegacyRegistration(registration)) continue;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription !== null) endpoints.push(subscription.endpoint);
  }
  return endpoints;
}

/** This page's own subscription, if the browser holds one. Asks for nothing. */
export async function ownSubscription(): Promise<PushSubscription | undefined> {
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
  if (!isOwnRegistration(registration)) return undefined;
  return (await registration?.pushManager.getSubscription()) ?? undefined;
}

/** The registration, once its worker is running; given up on rather than waited for forever. */
async function activeRegistration(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active?.state === 'activated') return registration;
  return new Promise((resolve, reject) => {
    const watched = new Set<ServiceWorker>();
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      registration.removeEventListener('updatefound', watch);
      for (const worker of watched) worker.removeEventListener('statechange', watch);
      if (error === undefined) resolve(registration);
      else reject(error);
    };
    const watch = (): void => {
      for (const worker of [registration.installing, registration.waiting, registration.active]) {
        if (worker !== null && !watched.has(worker)) {
          watched.add(worker);
          worker.addEventListener('statechange', watch);
        }
      }
      if (registration.active?.state === 'activated') finish();
    };
    const timer = setTimeout(() => finish(new Error('The worker did not start')), WORKER_READY_MS);
    registration.addEventListener('updatefound', watch);
    watch();
  });
}

/**
 * Stop the push workers of this origin: the other pages' (an earlier start of the agent served its page
 * under another path, and its worker would keep showing the agent's messages, so a message would
 * arrive twice) or all of them, this one's too. The agent forgets each address it is told of; one that
 * cannot be told is dropped by the agent when its push service answers that it is gone.
 */
async function forgetPages(api: IPersonalApi, which: 'others' | 'all'): Promise<void> {
  const own = new URL(PUSH_SCOPE, window.location.origin).href;
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    const script = (registration.active ?? registration.waiting ?? registration.installing)
      ?.scriptURL;
    if (script === undefined) continue;
    const isOwn = registration.scope === own && script === new URL(PUSH_WORKER, own).href;
    const isLegacy = isLegacyRegistration(registration);
    if (!isOwn && !isLegacy) continue;
    if (which === 'others' && isOwn) continue;
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription !== null) {
        const { endpoint } = subscription;
        await subscription.unsubscribe();
        await api.unsubscribePush(endpoint);
      }
    } catch {
      // allow-fallback: one worker that will not go must not keep the others from it.
    }
    await registration.unregister().catch(() => undefined);
  }
}

export type TEnabled =
  | { readonly state: 'on'; readonly subscribed: number }
  | { readonly state: 'off'; readonly subscribed?: number }
  | { readonly state: 'blocked' };

/**
 * Turn push on for this browser. The question about notifying comes first, in the press's own turn (a
 * browser honours the gesture only briefly), so a refusal leaves nothing registered; then the worker is
 * registered and the browser subscribes with the agent's public key. A refused subscription is kept
 * in the browser in case another tab is using it; an uncertain response is checked before cleanup.
 */
export async function enablePush(api: IPersonalApi): Promise<TEnabled> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { state: permission === 'denied' ? 'blocked' : 'off' };
  const existing = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
  if (
    existing?.scope === new URL(PUSH_SCOPE, window.location.origin).href &&
    !isOwnRegistration(existing)
  ) {
    throw new Error('Another worker already uses the notification scope');
  }
  const previous = await legacyEndpoints();
  const registration = await activeRegistration(
    await navigator.serviceWorker.register(PUSH_WORKER, { scope: PUSH_SCOPE }),
  );
  const key = keyBytes((await api.pushKey()).publicKey);
  let subscription = await registration.pushManager.getSubscription();
  // A subscription belongs to the key it was made with; one made with another key cannot take a push.
  if (subscription !== null && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  let status: IPushStatusView;
  try {
    status = await api.subscribePush(subscription.toJSON(), previous);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) throw error;
    const checked = await api.pushStatus(subscription.endpoint).catch(() => undefined);
    if (checked?.current === true) status = checked;
    else throw error;
  }
  await forgetPages(api, 'others').catch(() => undefined);
  const current = await api.pushStatus(subscription.endpoint).catch(() => status);
  if (current.current === false) return { state: 'off', subscribed: current.subscribed };
  return { state: 'on', subscribed: current.subscribed };
}

/** Turn push off for this browser, and for any earlier page of it; how many browsers remain subscribed. */
export async function disablePush(api: IPersonalApi): Promise<IPushStatusView> {
  await forgetPages(api, 'all');
  return api.pushStatus();
}

/** Stop this origin's workers and remove every browser from the agent. */
export async function disableAllPush(api: IPersonalApi): Promise<IPushStatusView> {
  if (pushSupported()) await forgetPages(api, 'all').catch(() => undefined);
  return api.clearPushSubscriptions();
}
