// The rules Obsidian's own review runs on every plugin (eslint-plugin-obsidianmd), with type information for src/.
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  globalIgnores(['node_modules', 'main.js', 'tests', 'esbuild.config.mjs', 'eslint.config.mjs']),
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.js'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      ...obsidianmd.ruleConfigs.recommendedTypeChecked,
      // replaced by obsidianmd/no-misused-promises
      '@typescript-eslint/no-misused-promises': 'off',
      // the sources are JavaScript without type annotations: these rules report every untyped value
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
]);
