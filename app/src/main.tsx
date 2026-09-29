/** Entry point of the shaping app. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development only: expose the store so the browser checks can drive the app.
if (import.meta.env.DEV) void import('./state/store').then((m) => Object.assign(window, { __app: m.useApp }));
