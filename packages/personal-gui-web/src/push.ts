/**
 * Notifications while the page is closed: a worker in the page shows what the agent pushes, and the
 * browser's own push service carries it there. Everything here runs from a press of a button in
 * Settings, never when the page loads, because the browser's question about notifying is only asked
 * for a deliberate press. The page never learns, keeps or shows a push address: it hands the browser's
 * subscription to the agent once and the agent tells it only a count.
 */
import type { IPersonalApi, IPushStatusView } from './api.js';

/** Served beside the page's index, so its scope is the page's own path. */
export const PUSH_WORKER = 'push-worker.js';
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

/** This page's own subscription, if the browser holds one. Asks for nothing. */
export async function ownSubscription(): Promise<PushSubscription | undefined> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? undefined;
}

/** The registration, once its worker is running; given up on rather than waited for forever. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The worker did not start')), WORKER_READY_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stop the push workers of this origin: the other pages' (an earlier start of the agent served its page
 * under another path, and its worker would keep showing the agent's messages, so a message would
 * arrive twice) or all of them, this one's too. The agent forgets each address it is told of; one that
 * cannot be told is dropped by the agent when its push service answers that it is gone.
 */
async function forgetPages(api: IPersonalApi, which: 'others' | 'all'): Promise<void> {
  const own = new URL('.', window.location.href).href;
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    const script = (registration.active ?? registration.waiting ?? registration.installing)
      ?.scriptURL;
    if (script === undefined || !script.endsWith(`/${PUSH_WORKER}`)) continue;
    if (which === 'others' && registration.scope === own) continue;
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription !== null) {
        const { endpoint } = subscription;
        await subscription.unsubscribe();
        await api.unsubscribePush(endpoint);
      }
      await registration.unregister();
    } catch {
      // allow-fallback: one worker that will not go must not keep the others from it.
    }
  }
}

export type TEnabled =
  { readonly state: 'on'; readonly subscribed: number } | { readonly state: 'blocked' | 'off' };

/**
 * Turn push on for this browser. The question about notifying comes first, in the press's own turn (a
 * browser honours the gesture only briefly), so a refusal leaves nothing registered; then the worker is
 * registered and the browser subscribes with the agent's public key. A subscription the agent will not
 * keep is taken back, so the browser and the agent agree.
 */
export async function enablePush(api: IPersonalApi): Promise<TEnabled> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { state: permission === 'denied' ? 'blocked' : 'off' };
  await forgetPages(api, 'others');
  await navigator.serviceWorker.register(PUSH_WORKER);
  const registration = await activeRegistration();
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
  try {
    const status = await api.subscribePush(subscription.toJSON());
    return { state: 'on', subscribed: status.subscribed };
  } catch (refused) {
    await subscription.unsubscribe().catch(() => undefined);
    throw refused;
  }
}

/** Turn push off for this browser, and for any earlier page of it; how many browsers remain subscribed. */
export async function disablePush(api: IPersonalApi): Promise<IPushStatusView> {
  await forgetPages(api, 'all');
  return api.pushStatus();
}
