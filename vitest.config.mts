import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The same alias as `tsconfig.json`, so the modules under test can import with
// `@/…` exactly as the rest of the application does.
const alias = { '@': fileURLToPath(new URL('.', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    // Two suites, split by environment rather than by folder.
    //
    // The data layer never touches the DOM — `fake-indexeddb` alone gives it a
    // complete IndexedDB under Node — and running its several hundred tests
    // under jsdom would buy a document none of them opens. The screens need
    // one. The extension decides: `.test.ts` is logic, `.test.tsx` renders.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'logic',
          environment: 'node',
          setupFiles: ['./test/setup.ts'],
          include: ['test/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'screens',
          environment: 'jsdom',
          setupFiles: ['./test/setup-dom.ts'],
          include: ['test/**/*.test.tsx'],
        },
      },
    ],
  },
});
