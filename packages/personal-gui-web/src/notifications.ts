/**
 * The open page as a place the agent can tell the person something: the shell asks the agent for new
 * messages every few seconds, whichever tab is showing (asking is what tells the agent a page is open),
 * shows one as a browser notification when the page is not in front of the person, and keeps the number
 * of questions waiting in the tab's title. Everything shown is plain text the agent wrote from content
 * other people wrote.
 */
import { useEffect, useRef, useState } from 'react';

import type { IBrowserNotificationView, IFeedItemView, IPersonalApi } from './api.js';

export const NOTIFICATION_POLL_MS = 5_000;

/** What the browser says about showing notifications: its own word, or `unsupported` when it has none. */
export type TNotificationPermission = NotificationPermission | 'unsupported';

export function notificationPermission(): TNotificationPermission {
  try {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  } catch {
    // allow-fallback: a browser that refuses to say has no notifications to offer.
    return 'unsupported';
  }
}

/** How many question cards still wait for an answer. */
export function openQuestionCount(items: readonly IFeedItemView[]): number {
  return items.filter((item) => item.question?.state === 'open').length;
}

const COUNT_PREFIX = /^\(\d+\) ?/u;

/** The tab title with the number of waiting questions in front of it, when there are any. */
export function titleWithCount(title: string, waiting: number): string {
  const bare = title.replace(COUNT_PREFIX, '');
  if (waiting <= 0) return bare;
  return bare === '' ? `(${waiting})` : `(${waiting}) ${bare}`;
}

/** Whether the person is looking at this page right now. */
function inFront(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * Show one message as a browser notification, if the person allowed them and is not looking at the
 * page. The tag is the message's id, so a repeat replaces the earlier one instead of stacking up. A
 * click brings the page forward and opens the feed. Returns whether one was shown.
 */
export function showNotification(message: IBrowserNotificationView, onOpen: () => void): boolean {
  if (notificationPermission() !== 'granted' || inFront()) return false;
  try {
    const notification = new Notification(message.title, {
      body: message.text,
      tag: String(message.id),
    });
    notification.onclick = () => {
      window.focus();
      onOpen();
      notification.close();
    };
    return true;
  } catch {
    // allow-fallback: a browser that will not make one here (some phones need a service worker) shows none.
    return false;
  }
}

/**
 * Polls for new messages and for how many questions wait, for as long as the shell is mounted. The
 * first answer only sets where to start from: what came before the page was open is in the feed, and
 * is not announced again. `setWaiting` lets a view that already knows the feed say so at once.
 */
export function usePageNotifications(
  api: IPersonalApi,
  onOpenFeed: () => void,
): { readonly waiting: number; readonly setWaiting: (waiting: number) => void } {
  const [waiting, setWaiting] = useState(0);
  const open = useRef(onOpenFeed);
  useEffect(() => {
    open.current = onOpenFeed;
  });
  // The count goes in front of whatever title the page has, and stays there when something else (the
  // chat, which names the folder it works in) sets the title again.
  useEffect(() => {
    const apply = (): void => {
      const next = titleWithCount(document.title, waiting);
      if (next !== document.title) document.title = next;
    };
    apply();
    const element = document.querySelector('title');
    const observer = new MutationObserver(apply);
    if (element !== null)
      observer.observe(element, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [waiting]);
  useEffect(() => {
    let stopped = false;
    let running = false;
    let after: number | undefined;
    const poll = async (): Promise<void> => {
      if (running) return;
      running = true;
      try {
        try {
          const answer = await api.notifications(after);
          if (stopped) return;
          if (after !== undefined)
            for (const message of answer.messages) showNotification(message, () => open.current());
          after = answer.latest;
        } catch {
          // allow-fallback: the agent may be restarting; the next poll asks again from the same place.
        }
        try {
          const items = await api.feed();
          if (!stopped) setWaiting(openQuestionCount(items));
        } catch {
          // allow-fallback: the count is a convenience; the feed itself says what waits.
        }
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), NOTIFICATION_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [api]);
  return { waiting, setWaiting };
}
