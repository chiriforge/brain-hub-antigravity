const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

async function build() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: true,
    minify: !isWatch,
    logLevel: 'info'
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build completed.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
