import React from 'react';
import ReactDOM from 'react-dom/client';

import type { IWebProductIdentity } from '@robota-sdk/agent-ui-web/client';
declare const __PRODUCT_PUBLIC_CONFIG__: IWebProductIdentity;

import { resolvePageProductIdentity } from './product-identity.js';
import { App } from './App.js';
import { ErrorBoundary } from './error-boundary.js';
import { resolveGuiHost } from './gui-host.js';
import { requireRootElement } from './root-element.js';
import './main.css';

import type { IDesktopBridge } from './gui-host.js';
import type { IDesktopSessionBridge } from '@robota-sdk/agent-ui-web/client';

declare global {
  interface Window {
    /** Present only inside the desktop app (apps/agent-app/electron/preload.ts). */
    readonly agentGui?: IDesktopBridge;
    readonly desktopSession?: IDesktopSessionBridge;
  }
}

const host = resolveGuiHost({ bridge: window.agentGui, desktopSession: window.desktopSession, document, location: window.location });

ReactDOM.createRoot(requireRootElement(document)).render(
  <React.StrictMode>
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden">
        <App host={host} product={resolvePageProductIdentity(document, __PRODUCT_PUBLIC_CONFIG__)} />
      </div>
    </ErrorBoundary>
  </React.StrictMode>,
);
