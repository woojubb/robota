import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import { createPersonalApi } from './api.js';
import './main.css';

const root = document.getElementById('root');
if (root === null) throw new Error('The page has no #root element');
const wsUrl =
  document.querySelector('meta[name="ws-url"]')?.getAttribute('content')?.trim() ||
  `ws://${window.location.host}`;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <div className="h-screen w-screen overflow-hidden">
      <App wsUrl={wsUrl} api={createPersonalApi()} />
    </div>
  </React.StrictMode>,
);
