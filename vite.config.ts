import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/**
 * Bundle the CLI into a single minified file: fewer modules to resolve and
 * parse at startup.
 */
export default defineConfig({
  build: {
    lib: {
      entry: { cli: './src/cli.ts' },
      formats: ['es'],
    },
    target: 'node22',
    minify: true,
    sourcemap: false,
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((module) => `node:${module}`),
      ],
    },
  },
});
