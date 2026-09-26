import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import { ErrorBoundary } from './error-boundary.js';
import { resolveGuiHost } from './gui-host.js';
import { requireRootElement } from './root-element.js';
import './main.css';

import type { IDesktopBridge } from './gui-host.js';

declare global {
  interface Window {
    /** Present only inside the desktop app (apps/agent-app/electron/preload.ts). */
    readonly agentGui?: IDesktopBridge;
  }
}

const host = resolveGuiHost({ bridge: window.agentGui, document, location: window.location });

ReactDOM.createRoot(requireRootElement(document)).render(
  <React.StrictMode>
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden">
        <App host={host} />
      </div>
    </ErrorBoundary>
  </React.StrictMode>,
);
