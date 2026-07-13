const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
// War Room decapitation (M1): the VS Code extension is QUARANTINED from the
// default build. Pass --extension explicitly to bundle dist/extension.js.
const withExtension = process.argv.includes('--extension');

/** Extension version read from package.json at build time, inlined via esbuild `define`. */
const pkgVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'),
).version;
const versionDefine = {
  'process.env.PIXEL_AGENTS_VERSION': JSON.stringify(pkgVersion),
};

/**
 * Copy assets folder to dist/assets
 */
function copyAssets() {
  const srcDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
  const dstDir = path.join(__dirname, 'dist', 'assets');

  if (fs.existsSync(srcDir)) {
    // Remove existing dist/assets if present
    if (fs.existsSync(dstDir)) {
      fs.rmSync(dstDir, { recursive: true });
    }

    // Copy recursively
    fs.cpSync(srcDir, dstDir, { recursive: true });
    console.log('✓ Copied assets/ → dist/assets/');
  } else {
    console.log('ℹ️  assets/ folder not found (optional)');
  }
}

/**
 * Bundle hook scripts (TypeScript) to dist/hooks via esbuild.
 * Produces a self-contained CJS file with shebang for Claude Code to execute.
 */
function buildHooks() {
  const entries = Object.fromEntries(
    ['claude', 'codex']
      .map((provider) => [
        `${provider}-hook`,
        path.join(
          __dirname,
          'server',
          'src',
          'providers',
          'hook',
          provider,
          'hooks',
          `${provider}-hook.ts`,
        ),
      ])
      .filter(([, entry]) => fs.existsSync(entry)),
  );
  if (Object.keys(entries).length === 0) return;
  const outdir = path.join(__dirname, 'dist', 'hooks');
  if (fs.existsSync(outdir)) fs.rmSync(outdir, { recursive: true });
  require('esbuild').buildSync({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outdir,
    banner: { js: '#!/usr/bin/env node' },
  });
  console.log('✓ Built hooks/ → dist/hooks/');
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

/** Bundle the VS Code extension. Opt-in only (`--extension`); not part of the standalone build. */
async function buildExtension() {
  await esbuild.build({
    entryPoints: ['adapters/vscode/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    define: versionDefine,
    logLevel: 'silent',
  });
  console.log('✓ Built extension → dist/extension.js (opt-in, --extension)');
}

async function main() {
  // Standalone-first: the default target is the CLI server bundle.
  const ctx = await esbuild.context({
    entryPoints: ['server/src/cli.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    platform: 'node',
    outfile: 'dist/cli.js',
    external: ['fastify', '@fastify/websocket', '@fastify/static', '@fastify/cors'],
    define: versionDefine,
    logLevel: 'silent',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    // Copy assets and hooks after build
    copyAssets();
    buildHooks();
    console.log('✓ Bundled CLI → dist/cli.js');
    if (withExtension) {
      await buildExtension();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
