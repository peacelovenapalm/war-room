import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import pixelAgentsPlugin from '../eslint-rules/pixel-agents-rules.mjs';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'pixel-agents': pixelAgentsPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // Colors live in src/constants.ts only (colorblind hard rule: color is
      // reinforcement, shape + text label is the signal — centralizing makes
      // that auditable). pixel-shadow / pixel-font are NOT enabled: v3 is a
      // new visual language, not the webview-ui pixel-art skin.
      'pixel-agents/no-inline-colors': 'error',
    },
  },
  {
    files: ['src/constants.ts'],
    rules: {
      'pixel-agents/no-inline-colors': 'off',
    },
  },
  eslintConfigPrettier,
]);
