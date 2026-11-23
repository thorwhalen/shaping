/** Entry point of the shaping app. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { PacingProvider } from './lib/pacing';
import { appPacing } from './state/settled';
import { registerServiceWorker } from './persist';
import { UndoToast } from 'undo-toast/react';
import 'undo-toast/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PacingProvider value={appPacing}>
      <App />
      <UndoToast />
    </PacingProvider>
  </StrictMode>,
);

registerServiceWorker();

// Development only: expose the store so the browser checks can drive the app.
if (import.meta.env.DEV) {
  void import('./state/store').then((m) => Object.assign(window, { __app: m.useApp }));
  void import('./viewer/Viewer').then((m) => Object.assign(window, { __capture: m.captureRef }));
  void import('./lib/pacing').then((m) => Object.assign(window, { __load: m.sharedLoad, __paintLoad: m.paintLoad }));
}
