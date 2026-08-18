import type { MetadataRoute } from 'next';

/**
 * Manifeste d'installation.
 *
 * `standalone` retire la barre d'adresse : en salle, ces ~90 px de hauteur
 * rendus au contenu font une ligne d'exercice de plus à l'écran. `portrait`
 * parce qu'on tient son téléphone d'une main entre deux séries.
 *
 * Attention : ce manifeste rend l'app **installable**, pas **hors ligne**.
 * Sans service worker, la coquille est toujours demandée au réseau.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Workout',
    short_name: 'Workout',
    description: 'Suivi de séances : poids et répétitions, série par série.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fr',
    background_color: '#f2f2f5',
    theme_color: '#f2f2f5',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
