module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      // Context/provider 檔案依慣例同時匯出 Provider 元件與 hook（useTheme 等），
      // react-refresh 的 HMR 提示對這類檔案是誤報，僅在此關閉
      files: [
        'src/contexts/**/*.tsx',
        'src/theme/**/*.tsx',
        'src/i18n/**/*.{ts,tsx}',
        'src/components/ui/Toast.tsx',
      ],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
