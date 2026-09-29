/**
 * Module-boundary rules (P02.02.07), enforcing PLAN.md's Domain Boundaries.
 *
 * Two rules carry most of the weight:
 *
 *   - `no-cross-module-internals` — a module may use another module's published application
 *     services and events, never reach into its `domain/` or `infrastructure/`. Cross-module
 *     repository imports are how a bounded context stops being one.
 *   - `provider-sdks-stay-in-adapters` — Twilio, Stripe, Google, Microsoft and AWS SDK code lives
 *     behind a port in `packages/integrations`, `packages/telephony` or `packages/ai`. A provider
 *     import in a domain module means the domain cannot be tested without the provider, and that
 *     a provider migration becomes a rewrite.
 *
 * `moduleSystems` deliberately includes `cjs`, so a `require()` cannot be used to step around a
 * rule that only looks at ESM imports.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means neither module can be understood, tested or replaced on its own, and it makes module initialisation order load-bearing.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Nothing imports this file. Either it is dead, or something is missing an import.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack|vitest|playwright|next|eslint|turbo)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '^(apps/server/src/main-|scripts/|evals/)',
          '/__fixtures__/',
        ],
      },
      to: {},
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'Modules talk through exported application services and domain events. Reaching into another module’s domain or infrastructure layer removes the boundary that makes it a bounded context (PLAN.md, Domain Boundaries).',
      from: { path: '^apps/server/src/modules/([^/]+)/' },
      to: {
        path: '^apps/server/src/modules/([^/]+)/(domain|infrastructure)/',
        pathNot: '^apps/server/src/modules/$1/',
      },
    },
    {
      name: 'only-platform-opens-transactions',
      severity: 'error',
      comment:
        'Only the platform module owns transactions and the tenant wrapper. Everything else goes through withTenant / withSystemWork (INV-01, INV-02).',
      from: {
        path: '^apps/server/src/modules/',
        pathNot: '^apps/server/src/modules/platform/',
      },
      to: { path: '^packages/db/src/(client|pool|transaction)' },
    },
    {
      name: 'provider-sdks-stay-in-adapters',
      severity: 'error',
      comment:
        'Provider SDK and raw HTTP code lives behind a port in packages/integrations, packages/telephony or packages/ai. A provider import elsewhere makes that code untestable without the provider.',
      from: {
        pathNot: '^(packages/(integrations|telephony|ai|testing)|scripts)/',
      },
      to: {
        dependencyTypes: ['npm'],
        path: '^(twilio|stripe|googleapis|@microsoft/microsoft-graph-client|@aws-sdk/|openai)',
      },
    },
    {
      name: 'no-app-imports-from-packages',
      severity: 'error',
      comment:
        'Shared packages must not depend on an application. The dependency runs the other way, or the code belongs in a package.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-does-not-import-server-internals',
      severity: 'error',
      comment:
        'The web app talks to the server over its HTTP contract, typed by packages/contracts. Importing server internals would ship server code, and possibly secrets, into the browser bundle.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/server/(?!.*contracts)' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Production code importing a devDependency works locally and fails in the runtime image, where devDependencies are not installed.',
      from: {
        path: '^(apps|packages)/',
        pathNot: [
          '\\.(test|spec)\\.tsx?$',
          '/__fixtures__/',
          '/e2e/',
          '\\.config\\.(ts|js|cjs|mjs)$',
          // @moin/config is build-time tooling: lint rules, tsconfig presets and boundary rules.
          // It is never installed into a runtime image, so its dev dependencies are its
          // production dependencies.
          '^packages/config/',
        ],
      },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node core modules are removed without a major-version warning.',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: '^(punycode|domain|constants|sys|_linklist|_stream_wrap)$',
      },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
