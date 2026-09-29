/**
 * "Install app": a one-click button where the browser offers it, hand-made steps on iPhone/iPad
 * and Android otherwise, and the reason to do it: nothing is stored on a server, so the browser
 * is where designs live, and an installed app is far less likely to have them cleared. Shows
 * nothing once installed. Also asks the browser for persistent storage.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { installer } from './index';
import { notify } from './notify';

const WHY = 'Your designs are stored only in this browser (nothing goes to a server), and a browser can clear the storage of a site it thinks is unused. Installing the app keeps your designs from being lost.';

const STEPS: Record<'ios' | 'android' | 'desktop', string> = {
  ios: 'On iPhone or iPad, in Safari: tap the Share button, then “Add to Home Screen”.',
  android: 'On Android, in Chrome: open the ⋮ menu, then “Install app” (or “Add to Home screen”).',
  desktop: 'In Chrome or Edge, use the install icon at the right of the address bar. Safari (Mac): File, then “Add to Dock”.',
};

export function InstallNotice() {
  const s = useSyncExternalStore(installer.subscribe, installer.getState);
  useEffect(() => void installer.protectStorage(), []);
  if (s.installed) return null;

  async function install() {
    const accepted = await installer.prompt();
    notify(accepted ? 'success' : 'info', accepted ? 'Installed. Open shaping from your apps.' : 'Not installed. You can install any time from here.');
  }

  return (
    <section aria-label="Install the app" className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Install shaping as an app</span>
        {s.canPrompt && (
          <button className="rounded bg-accent px-3 py-1 text-white" onClick={() => void install()}>
            Install app
          </button>
        )}
      </div>
      <p className="text-muted">{WHY}</p>
      {!s.canPrompt && <p>{STEPS[s.platform]}</p>}
      {s.persisted === false && <p className="text-xs text-muted">This browser has not yet promised to keep your designs. Export the collection now and then as a backup.</p>}
    </section>
  );
}
