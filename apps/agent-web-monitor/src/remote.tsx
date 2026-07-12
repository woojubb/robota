import React from 'react';
import ReactDOM from 'react-dom/client';

import { RemoteClient } from '@robota-sdk/agent-transport-webrtc-web/client';
import './main.css';

// REMOTE-009 Stage D: the browser remote client. Connection inputs come from THIS page's URL —
// the relay from the `?relay=` query, the rendezvous + secret from the `#` fragment (the secret never
// leaves the browser). No server-injected config.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <div className="h-screen w-screen overflow-hidden">
      <RemoteClient />
    </div>
  </React.StrictMode>,
);
