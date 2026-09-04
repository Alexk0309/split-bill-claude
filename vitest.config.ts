import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // `._*` are macOS AppleDouble sidecars; the project volume is not HFS+.
    exclude: ['node_modules/**', '.next/**', '**/._*'],
  },
});
