export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'warn',
    },
  },
];
