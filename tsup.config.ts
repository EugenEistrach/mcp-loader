import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/tool.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: ['zod'], // Bundle Zod to avoid version conflicts
});