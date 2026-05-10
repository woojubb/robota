import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionMonitor } from '../src/components/SessionMonitor.js';
import './main.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <div className="h-screen w-screen overflow-hidden">
      <SessionMonitor />
    </div>
  </React.StrictMode>,
);
