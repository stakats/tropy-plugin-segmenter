export default [
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // Omitting keys by destructuring into a rest object is deliberate here.
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }]
    }
  }
]
