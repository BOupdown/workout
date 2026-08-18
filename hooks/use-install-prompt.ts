'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/** `beforeinstallprompt` n'est pas dans les types du DOM : il n'est pas standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export interface InstallState {
  /** L'app tourne déjà depuis l'écran d'accueil. */
  installed: boolean;
  /** Le navigateur propose une installation en un tap. */
  canPrompt: boolean;
  promptInstall: () => Promise<void>;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Le mode d'affichage est un état du navigateur, pas de React : il se lit avec
 * `useSyncExternalStore`, qui fournit aussi l'instantané serveur et évite le
 * `setState` dans un effet.
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
    // Safari iOS, qui n'implémente pas `display-mode`.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Installation sur l'écran d'accueil.
 *
 * Ce n'est pas du confort. Safari plafonne à sept jours le stockage écrit par
 * script des sites sans interaction régulière ; une app installée échappe à ce
 * traitement. Installer, c'est donc d'abord protéger ses données.
 *
 * `beforeinstallprompt` n'existe que sur les navigateurs Chromium. Sur iOS il
 * n'y a pas d'API : l'écran affiche la marche à suivre manuelle.
 */
export function useInstallPrompt(): InstallState {
  const installed = useSyncExternalStore(subscribeToDisplayMode, isStandalone, () => false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // `setState` dans un abonnement à un système externe : c'est l'usage prévu
    // d'un effet, contrairement à un appel synchrone dans son corps.
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
