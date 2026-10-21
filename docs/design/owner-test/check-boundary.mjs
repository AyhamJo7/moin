// Consistency checks for the DG-10 prototype's network and authorisation boundary, read from the
// documents and pages themselves. No server is started and nothing is fetched: this checks what the
// material says and references, not a network. Run from the repository root:
//   node docs/design/owner-test/check-boundary.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, ...p), 'utf8');
const flat = (s) => s.replace(/\s+/gu, ' ');

const files = {
  record: read('..', '..', 'decisions', 'DG-10-owner-app-visual-language.md'),
  plan: read('..', 'owner-usability-test.md'),
  readme: read('README.md'),
  kit: read('session-kit.md'),
  sheet: read('observation-sheet.md'),
  index: read('prototype', 'index.html'),
  moderator: read('prototype', 'moderator.html'),
  js: read('prototype', 'prototype.js'),
  css: read('prototype', 'prototype.css'),
};
const failures = [];
let checks = 0;
const expect = (ok, what) => {
  checks += 1;
  if (!ok) failures.push(what);
};

// 1. No executable or broad serving instruction anywhere in the session material.
for (const [name, text] of Object.entries(files)) {
  for (const banned of ['0.0.0.0', 'http.server', '--bind', 'portproxy', 'netsh']) {
    expect(!text.includes(banned), `${name}: contains "${banned}"`);
  }
}

// 2. The recorded exception keeps its no-server boundary; the phone route is only a proposal.
const record = flat(files.record);
expect(record.includes('No server is run.'), 'record: the exception still says no server is run');
expect(
  /### Proposed amendment: phone access over the local network \(\*\*NOT AUTHORIZED\*\*\)/u.test(
    files.record,
  ),
  'record: the phone-access proposal is headed NOT AUTHORIZED',
);
expect(
  record.includes("doesn't govern loading the page's own files"),
  'record: CSP described precisely (connect-src does not cover loading its own files)',
);
expect(
  record.includes('Not a wildcard bind on all interfaces'),
  'record: a wildcard bind is excluded explicitly',
);

// 3. README, kit and plan agree with the record and say the session isn't ready for phones.
expect(
  flat(files.readme).includes("Participant's phone: NOT AUTHORIZED."),
  'readme: phone NOT AUTHORIZED',
);
expect(
  flat(files.readme).includes('**not ready** for a complete DG-10 session'),
  'readme: not ready',
);
expect(flat(files.readme).includes('No server is run'), 'readme: no server, like the record');
expect(flat(files.kit).includes('Currently NOT AUTHORIZED.'), 'kit: phone access NOT AUTHORIZED');
expect(
  flat(files.kit).includes('Never start a server without that record.'),
  'kit: no server without the record',
);
expect(
  flat(files.kit).includes('only with approved phone access'),
  'kit: block A gated on approval',
);
expect(
  flat(files.plan).includes('**not authorised** until the founder approves'),
  'plan: phone delivery gated',
);

// 4. Participant wording separates page delivery from sending data, and covers address logging.
for (const [name, text] of [
  ['index', files.index],
  ['moderator', files.moderator],
  ['kit', files.kit],
]) {
  const t = flat(text);
  expect(!t.includes('sendet nichts'), `${name}: claims "sendet nichts"`);
  expect(
    !t.includes('nichts an einen Server gesendet'),
    `${name}: claims "nichts an einen Server gesendet"`,
  );
  expect(
    !t.includes('nichts wird an einen Server gesendet'),
    `${name}: claims nothing is sent to a server`,
  );
}
expect(
  flat(files.index).includes('Ihre Eingaben gehen an keinen Dienst'),
  'index: inputs go to no service',
);
expect(
  flat(files.kit).includes(
    'die Adresse Ihres Telefons im lokalen Netz und die abgerufenen Seiten kurzzeitig protokollieren',
  ),
  'kit: consent covers possible address logging',
);
expect(
  flat(files.kit).includes('an keinen Dienst und keine Datenbank'),
  'kit: consent separates delivery from submission',
);

// 5. The prototype references no service, endpoint or external resource.
const SVG_NS = 'http://www.w3.org/2000/svg';
for (const name of ['index', 'moderator', 'js', 'css']) {
  const text = files[name].replaceAll(SVG_NS, '');
  expect(!/https?:\/\//u.test(text), `${name}: references an http(s) URL`);
  for (const banned of [
    '/api/',
    'keycloak',
    'realms',
    'localhost',
    '127.0.0.1',
    'amazonaws',
    ':8080',
    'fetch(',
    'XMLHttpRequest',
    'WebSocket',
    'sendBeacon',
  ]) {
    expect(!text.includes(banned), `${name}: references "${banned}"`);
  }
}
for (const name of ['index', 'moderator']) {
  const csp = files[name].match(/Content-Security-Policy"\s+content="([^"]+)"/u)?.[1] ?? '';
  expect(csp.includes("default-src 'none'"), `${name}: CSP default-src 'none'`);
  expect(csp.includes("connect-src 'none'"), `${name}: CSP connect-src 'none'`);
  expect(!csp.includes('unsafe-inline'), `${name}: CSP allows no inline code`);
}

// 5b. Approved, access-restricted evidence storage is a mandatory prerequisite, and nothing in the
// material invents a provider, retention period or controller.
const kit = flat(files.kit);
for (const needle of [
  'Evidence storage approved. Currently NOT APPROVED.',
  'storage location outside the repository',
  'authorised people only',
  'responsible controller and operator',
  'retention period and how deletion is carried out and confirmed',
  'consent forms, recordings and other participant evidence',
  'no identifiable data is collected',
  'the session does not start',
]) {
  expect(kit.includes(needle), `kit: storage prerequisite states "${needle}"`);
}

// 6. The reversal patches kept as mutation evidence still contain the old wording by design; they
//    are labelled as never to be applied.
expect(
  flat(read('mutation-evidence.md')).includes('They are evidence only: never apply them.'),
  'mutation-evidence: patches labelled as never to be applied',
);

// 7. The observation sheet records the authorisation and any server lifecycle.
expect(
  flat(files.sheet).includes('Phone-access approval'),
  'sheet: records the phone-access approval',
);

for (const f of failures) console.error(`FAIL ${f}`);
console.log(`${checks} boundary checks, ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
