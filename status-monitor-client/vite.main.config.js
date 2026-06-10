import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  resolve: {
    // Force CJS entry points so Vite doesn't pick up ESM "module" fields
    // that it then fails to bundle and falls back to require().
    mainFields: ['main'],
    conditions: ['node', 'require', 'default'],
  },
  // The Forge Vite plugin builds main process in SSR mode, which externalizes
  // all npm packages by default. noExternal forces mqtt (and ws, its transport
  // dep) to be inlined into the bundle so the packaged app has no node_modules.
  ssr: {
    noExternal: ['mqtt', 'ws'],
  },
  build: {
    rollupOptions: {
      external: ['electron', ...builtinModules, 'bufferutil', 'utf-8-validate'],
    },
  },
});
