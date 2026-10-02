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
          // A package's public entry point has no in-repo importer until a consumer exists, which
          // in a monorepo built phase by phase is the normal state, not a defect. Dead-code
          // detection still applies to every other file inside the package.
          '^packages/[^/]+/src/index\\.ts$',
          // Next.js app-router files are invoked by the framework by convention, never imported.
          '^apps/web/(app|pages)/',
          '^apps/web/(next\\.config|middleware|instrumentation)\\.',
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
        path: '^apps/server/src/modules/([^/]+)/(domain|infrastructure|http)/',
        pathNot: '^apps/server/src/modules/$1/',
      },
    },
    {
      name: 'only-platform-opens-transactions',
      severity: 'error',
      comment:
        'Only the platform module owns transactions and raw database handles. Everything else goes through withTenant / withSystemWork (INV-01, INV-02). Raw handles live behind the @moin/db/pool specifier precisely so this rule has an edge it can see: the earlier version targeted a file reachable only through the package barrel, so it could not fire for any import a developer would actually write.',
      from: {
        // Deliberately all of apps/server, not just modules/: code outside modules/ (health,
        // bootstrap) was ungoverned, and that is exactly where the first raw pool appeared.
        path: '^apps/server/src/',
        pathNot: '^apps/server/src/(modules/platform|health)/',
      },
      to: { path: '^packages/db/src/pool\\.ts$' },
    },
    {
      name: 'identity-is-api-only',
      severity: 'error',
      comment:
        'Sign-in and sessions run behind moin_identity, a credential only the api role holds (P06.06, ADR-0003). If the voice, worker or migrate graph could reach the identity module or its pool, a compromise of that process would be one configuration mistake away from minting sessions. The configuration loader refuses the credential for those roles; this keeps the code that would use it out of their graphs as well.',
      from: {
        path: '^apps/server/src/(main-(voice|worker|migrate)\\.ts|roots/(voice|worker|migrate)-root\\.module\\.ts)$',
      },
      to: {
        path: '^apps/server/src/modules/(identity-access/|platform/identity-pool\\.module\\.ts$)',
        reachable: true,
      },
    },
    {
      name: 'no-domain-imports-outward',
      severity: 'error',
      comment:
        'A module\u2019s domain layer holds business rules and must not reach outward into its own infrastructure or http layer, nor depend on a framework. Otherwise the rules can only be tested by standing up Nest, Fastify and a database, and the layering exists for nothing.',
      from: { path: '^apps/server/src/modules/[^/]+/domain/' },
      to: {
        path: '^apps/server/src/modules/[^/]+/(infrastructure|http)/',
      },
    },
    {
      name: 'no-domain-imports-frameworks',
      severity: 'error',
      comment:
        'Domain code stays framework-free: no NestJS, Fastify, pg or ORM imports. Provider and transport concerns belong in infrastructure and http.',
      from: { path: '^apps/server/src/modules/[^/]+/domain/' },
      to: {
        dependencyTypes: ['npm'],
        path: '^(@nestjs/|fastify|pg$|pg-|drizzle-orm|@aws-sdk/)',
      },
    },
    {
      name: 'no-http-imports-repositories',
      severity: 'error',
      comment:
        'HTTP controllers call application services, never repositories directly. A controller that reaches into infrastructure puts business rules in the transport layer, where no other caller can reuse them.',
      from: { path: '^apps/server/src/modules/[^/]+/http/' },
      to: { path: '^apps/server/src/modules/[^/]+/infrastructure/' },
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
      to: { path: '^apps/server/' },
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
    // Build output is generated, so an "orphan" there means nothing and drowns the real findings.
    exclude: { path: '(^|/)(dist|build|\\.next|\\.turbo|coverage)/' },
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
