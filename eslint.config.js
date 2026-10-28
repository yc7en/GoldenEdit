import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-preview/**',
      'node_modules/**',
      'src-tauri/**',
      'design/**',
      'scripts/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['frontend/**/*.ts'],
    rules: {
      // 边界铁律：只有 bridge/ 可以碰 Tauri API。
      // 预览侧代码将来要原样搬到网页版，任何其它位置的 import 都会断掉这条路。
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message:
                '只有 frontend/src/bridge/ 允许 import Tauri API（ARCHITECTURE §3）。请通过 bridge 暴露的函数访问。',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['frontend/src/bridge/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['scripts/**/*.{mjs,js}', '*.config.js', '*.config.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
      },
    },
  }
);
