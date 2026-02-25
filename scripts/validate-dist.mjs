import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const expected = {
  'packages/core': [
    'dist/index.mjs',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/adapters/claude.mjs',
    'dist/adapters/claude.js',
    'dist/adapters/claude.d.ts',
    'dist/adapters/claude.d.cts',
    'dist/adapters/openai.mjs',
    'dist/adapters/openai.js',
    'dist/adapters/openai.d.ts',
    'dist/adapters/openai.d.cts',
    'dist/testing/index.mjs',
    'dist/testing/index.js',
    'dist/testing/index.d.ts',
    'dist/testing/index.d.cts',
  ],
  'packages/adapter-claude': [
    'dist/index.mjs',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/index.d.cts',
  ],
  'packages/adapter-openai': [
    'dist/index.mjs',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/index.d.cts',
  ],
};

const missing = [];

for (const [pkg, files] of Object.entries(expected)) {
  for (const file of files) {
    const fullPath = join(root, pkg, file);
    if (!existsSync(fullPath)) {
      missing.push(`${pkg}/${file}`);
    }
  }
}

if (missing.length > 0) {
  console.error('Build validation failed! Missing dist files:\n');
  for (const entry of missing) {
    console.error(`  MISSING: ${entry}`);
  }
  console.error(`\n${missing.length} file(s) missing.`);
  process.exit(1);
} else {
  console.log(`All ${Object.values(expected).flat().length} dist files present.`);
}
