import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/claude': 'src/adapters/claude.ts',
    'adapters/openai': 'src/adapters/openai.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: {
    // Only generate DTS for non-adapter entries to avoid cyclic dependency
    // with adapter packages. Adapter subpaths use manual .d.ts stubs.
    entry: {
      index: 'src/index.ts',
      'testing/index': 'src/testing/index.ts',
    },
  },
  target: 'node18',
  outDir: 'dist',
  clean: true,
  splitting: false,
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.js',
    };
  },
});
