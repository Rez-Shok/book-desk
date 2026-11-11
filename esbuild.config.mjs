// Bundles src/ into main.js, the one script Obsidian loads. `node esbuild.config.mjs production` makes the release build.
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  // Obsidian provides these at run time; nothing else is bundled in, and the plugin has no other dependency
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  minify: production,
  outfile: 'main.js',
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
