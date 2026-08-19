import type { MetadataRoute } from 'next';

/**
 * Install manifest.
 *
 * `standalone` drops the address bar: in the gym, those ~90px given back to the
 * content are one more exercise row on screen. `portrait` because the phone is
 * held one-handed between sets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Workout',
    short_name: 'Workout',
    description: 'Training log: weights and reps, set by set.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'en',
    background_color: '#f2f2f5',
    theme_color: '#f2f2f5',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
