import { useEffect, useState } from 'react';

import { notificationPermission } from '../notifications.js';
import { disablePush, enablePush, ownSubscription, pushSupported } from '../push.js';
import { Button, errorText } from './ui.js';

import type { IPersonalApi } from '../api.js';

type TPushState = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on';

const STATE_TEXT: Readonly<Record<TPushState, string>> = {
  checking: 'Checking…',
  unsupported:
    'This browser cannot be notified while the page is closed here: it needs push support and a page served over https or from this computer.',
  blocked:
    'Blocked. Your browser will not show notifications from this page; change that in its site settings.',
  off: 'Off. Press the button, then choose Allow when your browser asks.',
  on: 'On. Your agent can notify this browser while the page is closed.',
};

/** What the browser says now, once the agent and the browser have both been asked. */
const settled = (subscribed: boolean): TPushState => {
  const permission = notificationPermission();
  if (permission === 'denied') return 'blocked';
  return subscribed && permission === 'granted' ? 'on' : 'off';
};

/**
 * Notifications for when this page is closed, under the same limits as every other place the agent can
 * reach the person. The browser's question about notifying is asked only when the person presses the
 * button, and what is shown is plain text. The page keeps and shows no push address: the agent tells it
 * how many browsers are subscribed.
 */
export function PushNotifications({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const supported = pushSupported();
  const [state, setState] = useState<TPushState>(supported ? 'checking' : 'unsupported');
  const [subscribed, setSubscribed] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    // Only reads: nothing is registered, asked or changed until the person presses the button.
    Promise.all([api.pushStatus(), ownSubscription()]).then(
      ([status, own]) => {
        if (cancelled) return;
        setSubscribed(status.subscribed);
        // It is on only when the browser holds a subscription and the agent holds one too: a browser that
        // holds one the agent never kept (the agent's key was made anew) is not reachable, so it is off.
        setState(settled(own !== undefined && status.subscribed > 0));
      },
      (caught: unknown) => {
        if (cancelled) return;
        setMessage({ text: errorText(caught), error: true });
        setState(settled(false));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, supported]);
  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    setMessage(undefined);
    work()
      .catch((caught: unknown) => setMessage({ text: errorText(caught), error: true }))
      .finally(() => setBusy(false));
  };
  return (
    <section
      aria-label="Notifications when the page is closed"
      className="flex flex-col gap-2 text-[13px]"
    >
      <h2 className="text-[15px] font-semibold">Notifications when this page is closed</h2>
      <p className="text-muted-foreground">
        Your agent can also notify this browser while the page is closed, under the same limits as
        everywhere else. A question that is not pushed stays in your Feed.
      </p>
      <p role="status" className={message?.error ? 'text-destructive' : 'text-muted-foreground'}>
        {message?.text ?? STATE_TEXT[state]}
      </p>
      {subscribed !== undefined && state !== 'unsupported' && (
        <p className="text-[12.5px] text-muted-foreground">
          {subscribed} {subscribed === 1 ? 'browser is' : 'browsers are'} subscribed.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={busy || state !== 'off'}
          onClick={() =>
            // The browser's question is asked in this press, which is the gesture it requires.
            run(async () => {
              const result = await enablePush(api);
              setState(result.state);
              if (result.state === 'on') setSubscribed(result.subscribed);
            })
          }
        >
          Also notify me when this page is closed
        </Button>
        <Button
          disabled={busy || state !== 'on'}
          onClick={() =>
            run(async () => {
              const status = await disablePush(api);
              setSubscribed(status.subscribed);
              setState(settled(false));
            })
          }
        >
          Stop
        </Button>
      </div>
    </section>
  );
}
