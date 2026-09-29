/**
 * Install as an app, and keep the browser from evicting what is stored.
 *
 * Nothing is stored on a server: designs and images live in this browser, and a browser may clear
 * the storage of a site it considers unused (Safari after about a week without a visit; others
 * when the disk is low). An installed app, and a site that has been granted persistent storage
 * (`navigator.storage.persist()`), are exempt or far less likely to be cleared. So the page
 *
 * - keeps the browser's `beforeinstallprompt` event (Chrome, Edge, Android) to offer a one-click
 *   install, and forgets it once the app is installed;
 * - otherwise says how to install by hand on iPhone/iPad (Safari's Share menu, "Add to Home
 *   Screen"; Apple offers no install API) and Android;
 * - hides all of it when already running as an installed app;
 * - asks for persistent storage (`protectStorage`).
 *
 * The listener is attached when this module loads, because the browser fires the event once,
 * early, and it would be lost if the gallery had not mounted yet.
 */
import type { InstallState, Installer } from './types';

/** The event Chromium browsers fire when the page can be installed (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function detectPlatform(userAgent: string, maxTouchPoints = 0): InstallState['platform'] {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  // iPadOS 13+ presents itself as a Mac; only it has a Mac user agent and a touch screen.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'desktop';
}

export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return Boolean(win.matchMedia?.('(display-mode: standalone)').matches) || nav.standalone === true;
}

export function createInstaller(win: Window = window): Installer {
  const listeners = new Set<() => void>();
  let deferred: BeforeInstallPromptEvent | null = null;
  let state: InstallState = {
    installed: isStandalone(win),
    canPrompt: false,
    platform: detectPlatform(win.navigator.userAgent, win.navigator.maxTouchPoints),
    persisted: null,
  };

  const set = (patch: Partial<InstallState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button instead of the browser's mini-bar
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    set({ installed: true, canPrompt: false });
  });
  win.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => set({ installed: isStandalone(win) }));
  void win.navigator.storage?.persisted?.().then((persisted) => set({ persisted })).catch(() => undefined);

  async function protectStorage(): Promise<boolean> {
    const storage = win.navigator.storage;
    if (!storage?.persist) return false;
    try {
      const persisted = (await storage.persisted?.()) || (await storage.persist());
      set({ persisted });
      return persisted;
    } catch {
      return false;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async prompt() {
      const event = deferred;
      if (!event) return false;
      deferred = null; // the event can be used once
      set({ canPrompt: false });
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') void protectStorage();
      return outcome === 'accepted';
    },
    protectStorage,
  };
}

/** Register the service worker that keeps the app shell for offline use (production builds only). */
export function registerServiceWorker(base: string = import.meta.env.BASE_URL): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((e) => console.warn('shaping: offline support is unavailable:', e));
    // A new version took over (a deploy): reload once, so this tab never asks for chunks of the old
    // build that the server no longer has. Not on the first install, when there was no controller.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
  });
}
