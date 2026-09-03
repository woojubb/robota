import React from 'react';
import ReactDOM from 'react-dom/client';

import { SessionMonitor } from '@robota-sdk/agent-transport-gui/client';

import { ErrorBoundary } from './error-boundary.js';
import { requireRootElement } from './root-element.js';
import { readInjectedWsUrl, resolveWsUrl } from './ws-url.js';
import './main.css';

// WS URL is injected by the HTTP server via <meta name="ws-url">; fallback is the page's own host.
const wsUrl = resolveWsUrl(readInjectedWsUrl(document), window.location.host);

const rootEl = requireRootElement(document);

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden">
        <SessionMonitor wsUrl={wsUrl} />
      </div>
    </ErrorBoundary>
  </React.StrictMode>,
);
