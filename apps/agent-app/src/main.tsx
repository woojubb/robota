import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('agent-gui: #root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
