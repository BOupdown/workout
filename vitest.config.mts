import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Même alias que `tsconfig.json`, pour que les modules testés puissent
    // importer en `@/…` comme le reste de l'application.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // La couche de données ne touche jamais au DOM : `fake-indexeddb` suffit à
    // fournir un IndexedDB complet côté Node.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
