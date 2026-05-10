import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionMonitor } from '../src/components/SessionMonitor.js';
import './main.css';

// WS URL is injected by the HTTP server via <meta name="ws-url">.
// Fallback: same host (works when WS and HTTP share a port).
const wsUrl =
  document.querySelector('meta[name="ws-url"]')?.getAttribute('content') ??
  `ws://${window.location.host}`;

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <div className="h-screen w-screen overflow-hidden">
      <SessionMonitor wsUrl={wsUrl} />
    </div>
  </React.StrictMode>,
);
