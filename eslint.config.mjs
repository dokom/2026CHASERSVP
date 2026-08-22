import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/generated/**',
      '.mongo/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Guest-supplied text (names, dietary notes, invite labels) renders
      // throughout the admin panel. Raw HTML injection is forbidden.
      'react/no-danger': 'error',
      // `{ omitted, ...rest }` is the standard idiom for dropping a key from
      // an object; without this, every use of it is flagged as an "unused"
      // variable even though discarding it is the point.
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
    },
  },
  {
    // console.warn/console.error are used deliberately for operational
    // signals in application code; bare console.log is not allowed there.
    // Scoped to src/ only — prisma/seed.ts is a CLI script that legitimately
    // logs its own summary to stdout.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // src/lib/auth/csrf.ts uses a function-scoped `require('node:crypto')`
    // deliberately: this module is also imported by src/middleware.ts, which
    // is bundled for the Edge runtime, and a top-level `import` of
    // `node:crypto` would be evaluated eagerly there and crash every
    // `/admin` request, even though the Edge path never calls this function.
    // Converting to dynamic `import()` would make verifyCsrfToken async and
    // change its call sites' behavior, which is out of scope for a lint
    // fix — see the report for this file's disposition.
    files: ['src/lib/auth/csrf.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]

export default eslintConfig
