import { build, context } from 'esbuild';
import process from 'process';

const watch = process.argv.includes('--watch');
const production = !watch;

const shared = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  outfile: 'main.js',
  external: [
    'obsidian',
    '@codemirror/view',
    '@codemirror/state',
  ],
  logLevel: 'info',
  sourcemap: production,
  minify: production,
  legalComments: 'none',
};

if (watch) {
  const ctx = await context(shared);
  await ctx.watch();
  console.log('[task-workflow-enhancer] watching src/main.js');
} else {
  await build(shared);
  console.log('[task-workflow-enhancer] build complete');
}
