/**
 * The repository's shared ESLint flat configuration (P02.02.04).
 *
 * Each ban below exists because of a specific failure it prevents, not as style preference:
 *
 *   - `no-explicit-any` — `any` silently disables every other type-driven rule in this config,
 *     including the ones that catch unawaited promises.
 *   - no default exports — a default export can be imported under any name, so a rename refactor
 *     or a wrong-module import fails at runtime instead of at the type check. Next.js route,
 *     page, layout and config files are excepted because the framework requires them (A-22).
 *   - `dangerouslySetInnerHTML` — stored-XSS carrier; owner-app content is rendered as text.
 *   - string-built SQL — the SQL-injection path. Parameterised queries or the query builder.
 *   - session-level `SET` — `SET app.organisation_id = ...` outside a transaction leaks the
 *     tenant context onto the next checkout of a pooled connection (INV-01, INV-02).
 *   - `console.*` in production code — bypasses the Pino redaction allowlist, which is the only
 *     thing keeping personal data out of logs (INV-12).
 *   - floating promises — an unawaited write is a business mutation that may never happen and
 *     never reports that it did not (INV-06).
 */

import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { moinPlugin } from './rules/index.ts';

const NEXT_FRAMEWORK_FILES = [
  '**/app/**/page.tsx',
  '**/app/**/layout.tsx',
  '**/app/**/route.ts',
  '**/app/**/error.tsx',
  '**/app/**/loading.tsx',
  '**/app/**/not-found.tsx',
  '**/app/**/template.tsx',
  '**/app/**/default.tsx',
  '**/middleware.ts',
  '**/next.config.*',
  '**/*.config.ts',
  '**/*.config.js',
  '**/*.config.mjs',
];

const TEST_FILES = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/e2e/**',
  '**/__fixtures__/**',
];

/** `SET app.x = ...` outside a transaction — the pooled-connection tenant-context leak. */
const SESSION_SET_PATTERN = String.raw`\bSET\s+(?:SESSION\s+)?(?:app\.|search_path|role\b)`;

/** String-built SQL: a template literal or concatenation that opens with a SQL verb. */
const SQL_VERB_PATTERN = String.raw`^\s*(?:SELECT|INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b`;

export const baseConfig = defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/.turbo/**',
    '**/node_modules/**',
    '**/*.tsbuildinfo',
    // Fixtures violate the rules on purpose; bans.test.ts lints them explicitly.
    '**/__fixtures__/**',
  ]),

  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: { moin: moinPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Numbers stringify predictably; everything else must be converted explicitly, so a
      // `[object Object]` or a silent `undefined` cannot reach a log line or a user.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message:
            'Named exports only: a default export can be imported under any name, so a wrong import fails at runtime instead of at the type check. Next.js framework files are excepted.',
        },
        {
          selector: `JSXAttribute[name.name='dangerouslySetInnerHTML']`,
          message:
            'dangerouslySetInnerHTML is a stored-XSS carrier. Render owner- and caller-supplied content as text.',
        },
        {
          selector: `TemplateLiteral[expressions.length>0] > TemplateElement.quasis:first-child[value.raw=/${SQL_VERB_PATTERN}/i]`,
          message:
            'SQL built by string interpolation is the injection path. Use parameterised queries or the query builder.',
        },
        {
          selector: `BinaryExpression[operator='+'] > Literal.left[value=/${SQL_VERB_PATTERN}/i]`,
          message:
            'SQL built by string concatenation is the injection path. Use parameterised queries or the query builder.',
        },
        {
          selector: `Literal[value=/${SESSION_SET_PATTERN}/i]`,
          message:
            'Session-level SET leaks onto the next checkout of a pooled connection. Use set_config(..., true) inside the transaction, through the tenant wrapper (INV-01, INV-02).',
        },
        {
          selector: `TemplateElement[value.raw=/${SESSION_SET_PATTERN}/i]`,
          message:
            'Session-level SET leaks onto the next checkout of a pooled connection. Use set_config(..., true) inside the transaction, through the tenant wrapper (INV-01, INV-02).',
        },
      ],

      'no-console': 'error',

      // Authored in P02.02.05, enforced repository-wide in P06.03 (see rules/index.ts).
      'moin/no-tenant-conditional': 'off',
      'moin/no-direct-db-access': 'off',
    },
  },

  {
    files: NEXT_FRAMEWORK_FILES,
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  {
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // A NestJS module, and a Nest root module in particular, is an empty class whose entire
  // content is its decorator — that is the framework's declaration syntax, not a class someone
  // forgot to finish. The rule stays on everywhere else, because elsewhere it is usually right.
  {
    files: ['**/*.module.ts', '**/roots/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // Repository scripts and config files are CLIs: their output IS the interface, and they run
  // outside the service, where the Pino logger and its redaction allowlist do not exist.
  {
    files: ['scripts/**/*.ts', '**/*.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Plain JavaScript config files are not part of any tsconfig, so the type-aware rules have no
  // program to consult. Running them anyway produces a parsing error, not a finding.
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },

  prettier,
);

export { moinPlugin };
