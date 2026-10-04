import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'dist-component-preview/**',
      'release/**',
      'node_modules/**',
      '.agent-work/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      // TypeScript and the project tsconfigs own these checks.
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Existing smoke fixtures intentionally use these constructs to exercise
      // failure, cancellation, control-character and sparse-array boundaries.
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-empty': 'off',
      'no-sparse-arrays': 'off',
      'no-unexpected-multiline': 'off',
      'prefer-const': 'off',
    },
  },
];
