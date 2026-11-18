import { useEffect, useState } from 'react';

import { notificationPermission } from '../notifications.js';
import {
  disableAllPush,
  disablePush,
  enablePush,
  hasLegacySubscription,
  ownSubscription,
  pushSupported,
} from '../push.js';
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
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    // Only reads: nothing is registered, asked or changed until the person presses the button.
    (supported
      ? Promise.all([
          ownSubscription().then(
            (own) => ({ own, failed: false }),
            () => ({ own: undefined, failed: true }),
          ),
          hasLegacySubscription().catch(() => true),
        ])
      : Promise.resolve([{ own: undefined, failed: false }, false] as const)
    )
      .then(async ([browser, earlier]) => ({
        status: await api.pushStatus(browser.own?.endpoint),
        earlier,
        failed: browser.failed,
      }))
      .then(
        ({ status, earlier, failed }) => {
          if (cancelled) return;
          setSubscribed(status.subscribed);
          setLegacy(earlier);
          if (supported) setState(settled(status.current === true));
          if (failed)
            setMessage({
              text: 'Could not check this browser’s notification subscription.',
              error: true,
            });
        },
        (caught: unknown) => {
          if (cancelled) return;
          setMessage({ text: errorText(caught), error: true });
          if (supported) setState(settled(false));
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
      {subscribed !== undefined && (
        <p className="text-[12.5px] text-muted-foreground">
          {subscribed} {subscribed === 1 ? 'browser is' : 'browsers are'} subscribed.
        </p>
      )}
      {legacy && (
        <p className="text-[12.5px] text-muted-foreground">
          This browser may have an older notification subscription. Enable it again to replace it,
          or stop this browser.
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
              if ('subscribed' in result && result.subscribed !== undefined) {
                setSubscribed(result.subscribed);
                setLegacy(await hasLegacySubscription().catch(() => true));
              }
            })
          }
        >
          Also notify me when this page is closed
        </Button>
        <Button
          disabled={busy || (state !== 'on' && !legacy)}
          onClick={() =>
            run(async () => {
              const status = await disablePush(api);
              setSubscribed(status.subscribed);
              setState(settled(false));
              setLegacy(await hasLegacySubscription().catch(() => true));
            })
          }
        >
          Stop
        </Button>
        {(subscribed ?? 0) > 0 && (
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const status = await disableAllPush(api);
                setSubscribed(status.subscribed);
                if (supported) setState(settled(false));
                if (supported) setLegacy(await hasLegacySubscription().catch(() => true));
              })
            }
          >
            Remove all browsers from this agent
          </Button>
        )}
      </div>
    </section>
  );
}
