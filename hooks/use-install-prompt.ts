'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/** `beforeinstallprompt` is not in the DOM types: it is not standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export interface InstallState {
  /** The app is already running from the home screen. */
  installed: boolean;
  /** The browser offers a one-tap install. */
  canPrompt: boolean;
  promptInstall: () => Promise<void>;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Display mode is browser state, not React state: it is read with
 * `useSyncExternalStore`, which also supplies the server snapshot and avoids
 * `setState` inside an effect.
 */
function subscribeToDisplayMode(onChange: () => void): () => void {
  const media = window.matchMedia(STANDALONE_QUERY);
  media.addEventListener('change', onChange);
  window.addEventListener('appinstalled', onChange);

  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener('appinstalled', onChange);
  };
}

function isStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    // iOS Safari, which does not implement `display-mode`.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Installing to the home screen.
 *
 * This is not a convenience. Safari caps script-writable storage at seven days
 * for sites without regular interaction; an installed app escapes that
 * treatment. Installing is therefore first and foremost about protecting data.
 *
 * `beforeinstallprompt` only exists on Chromium browsers. On iOS there is no
 * API: the screen spells out the manual steps instead.
 */
export function useInstallPrompt(): InstallState {
  const installed = useSyncExternalStore(subscribeToDisplayMode, isStandalone, () => false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // `setState` inside a subscription to an external system: the intended use
    // of an effect, unlike a synchronous call in its body.
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    installed,
    canPrompt: deferred !== null,
    promptInstall: async () => {
      if (!deferred) return;
      await deferred.prompt();
      setDeferred(null);
    },
  };
}
