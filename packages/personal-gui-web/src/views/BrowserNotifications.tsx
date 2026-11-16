import { useState } from 'react';

import { notificationPermission } from '../notifications.js';
import { Button } from './ui.js';

import type { TNotificationPermission } from '../notifications.js';

const STATE_TEXT: Readonly<Record<TNotificationPermission, string>> = {
  default: 'Not allowed yet. Press the button, then choose Allow when your browser asks.',
  granted:
    'Allowed. While another tab or window is in front, this page shows a notification when your agent asks you something.',
  denied:
    'Blocked. Your browser will not show notifications from this page; change that in its site settings.',
  unsupported: 'This browser cannot show notifications.',
};

/**
 * Notifications from this page while it is open. The browser asks for permission only when the person
 * presses the button, never when the page loads, and what it shows is plain text. A page that is closed
 * shows nothing: a notification address is what reaches the person then.
 */
export function BrowserNotifications(): React.ReactElement {
  const [permission, setPermission] = useState<TNotificationPermission>(notificationPermission);
  return (
    <section aria-label="Browser notifications" className="flex flex-col gap-2 text-[13px]">
      <h2 className="text-[15px] font-semibold">Notifications in this browser</h2>
      <p className="text-muted-foreground">
        They work only while this page is open, and the tab title counts the questions waiting in
        your Feed. To be reached when it is closed, use a notification address.
      </p>
      <p role="status" className="text-muted-foreground">
        {STATE_TEXT[permission]}
      </p>
      <div>
        <Button
          disabled={permission !== 'default'}
          onClick={() => {
            // Asked here, from the press, which is the gesture a browser requires; never on load.
            Promise.resolve(Notification.requestPermission()).then(
              (answer) => setPermission(answer),
              () => setPermission(notificationPermission()),
            );
          }}
        >
          Allow notifications in this browser
        </Button>
      </div>
    </section>
  );
}
