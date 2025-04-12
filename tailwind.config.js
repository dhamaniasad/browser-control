/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {},
  },
  purge: {
    enabled: false,
    content: [
      './src/**/*.html',
      './src/**/*.vue',
      './src/**/*.jsx',
      './src/**/*.tsx',
      './src/**/*.ts',
      // './**/*'
    ]
  },
  plugins: [],
  safelist: [
    {
      pattern: /./,
      variants: ['sm', 'md', 'lg', 'xl', '2xl'],
    } // Force include ALL classes
  ]
}
