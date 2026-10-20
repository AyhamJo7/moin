// DG-10 owner-test prototype: an in-browser SIMULATION of Heute in the work-queue layout
// (DESIGN.md §4). Synthetic data only. No request leaves the page (its CSP has connect-src
// 'none'), nothing reaches a server or database, and "Erledigt" only changes this tab's
// sessionStorage. It is test material for the owner usability test, not application code: nothing
// here may be imported into apps/web or packages/ui (see ../README.md).
'use strict';

(() => {
  const VERSION = 'DG-10-Prototyp 1';
  const KEY = 'dg10-prototype:';
  // A request round trip and the server re-read, slow enough for the owner to see the state.
  const PENDING_MS = 1200;
  const LOADING_MS = 1800;
  // Synthetic clock: the scenario morning starts at 09:42 and runs in real minutes from there.
  const CLOCK_START_MIN = 9 * 60 + 42;
  const PAGE_DATE = 'Dienstag, 20. Oktober 2026';

  const task = (id, title, phone, at, iso, urgent = false) => ({
    id,
    title,
    phone,
    at,
    iso,
    urgent,
  });
  // The four canonical callback titles; numbers are the +49 30 0000… fixtures, not subscriber numbers.
  const MORNING = [
    task(
      't101',
      'Rückruf erbeten',
      '+493000000101',
      '20.10.2026, 09:14',
      '2026-10-20T07:14:00Z',
      true,
    ),
    task(
      't102',
      'Rückruf: Reservierung',
      '+493000000102',
      '20.10.2026, 08:58',
      '2026-10-20T06:58:00Z',
    ),
    task(
      't103',
      'Rückruf: Geburtstagsfeier',
      '+493000000103',
      '20.10.2026, 08:31',
      '2026-10-20T06:31:00Z',
    ),
    task(
      't104',
      'Rückruf: Reservierung für Geburtstagsfeier',
      '+493000000104',
      '20.10.2026, 07:47',
      '2026-10-20T05:47:00Z',
    ),
  ];
  const BUSY = [
    task(
      'b1',
      'Rückruf erbeten',
      '+493000000101',
      '20.10.2026, 09:14',
      '2026-10-20T07:14:00Z',
      true,
    ),
    task(
      'b2',
      'Rückruf: Reservierung',
      '+493000000102',
      '20.10.2026, 09:02',
      '2026-10-20T07:02:00Z',
      true,
    ),
    task(
      'b3',
      'Rückruf: Geburtstagsfeier',
      '+493000000103',
      '20.10.2026, 08:58',
      '2026-10-20T06:58:00Z',
    ),
    task(
      'b4',
      'Rückruf: Reservierung für Geburtstagsfeier',
      '+493000000104',
      '20.10.2026, 08:44',
      '2026-10-20T06:44:00Z',
    ),
    task('b5', 'Rückruf erbeten', '+493000000105', '20.10.2026, 08:31', '2026-10-20T06:31:00Z'),
    task(
      'b6',
      'Rückruf: Reservierung',
      '+493000000106',
      '20.10.2026, 08:12',
      '2026-10-20T06:12:00Z',
    ),
    task(
      'b7',
      'Rückruf: Geburtstagsfeier',
      '+493000000107',
      '20.10.2026, 07:47',
      '2026-10-20T05:47:00Z',
    ),
    task(
      'b8',
      'Rückruf: Reservierung für Geburtstagsfeier',
      '+493000000108',
      '19.10.2026, 22:41',
      '2026-10-19T20:41:00Z',
    ),
    task('b9', 'Rückruf erbeten', '+493000000109', '19.10.2026, 21:58', '2026-10-19T19:58:00Z'),
    task(
      'b10',
      'Rückruf: Reservierung',
      '+493000000110',
      '19.10.2026, 21:13',
      '2026-10-19T19:13:00Z',
    ),
  ];

  /** The moderator picks one with ?szenario=…; see moderator.html. */
  const SCENARIOS = {
    morgen: { tasks: MORNING },
    voll: { tasks: BUSY },
    leer: { tasks: [] },
    laden: { tasks: MORNING, loading: true },
    fehler: { tasks: MORNING, failFirst: true },
    'nicht-moeglich': { tasks: MORNING, unavailable: ['t102'] },
  };

  const SECTIONS = [
    ['urgent', 'Dringend'],
    ['callbacks', 'Rückrufe'],
    ['requests', 'Neue Anfragen'],
    ['appointments', 'Termine/Reservierungen zu bestätigen'],
    ['questions', 'Offene Kundenfragen'],
  ];

  // --- tab-local state (sessionStorage: dies with the tab, never leaves the device) ----------

  const store = {
    get(name, fallback) {
      try {
        const raw = sessionStorage.getItem(KEY + name);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(name, value) {
      try {
        sessionStorage.setItem(KEY + name, JSON.stringify(value));
      } catch {
        // Private mode without storage: the session still works, it just forgets on reload.
      }
    },
    clear() {
      try {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith(KEY)) sessionStorage.removeItem(key);
        }
      } catch {
        // Nothing stored, nothing to clear.
      }
    },
  };

  // --- DOM helpers (textContent only: no markup is ever built from strings) -----------------

  const SVG = 'http://www.w3.org/2000/svg';

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value);
    }
    node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  function icon(id) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', `#i-${id}`);
    svg.append(use);
    return svg;
  }

  // --- the page ------------------------------------------------------------------------------

  const params = new URLSearchParams(location.search);
  const scenarioName = Object.hasOwn(SCENARIOS, params.get('szenario') ?? '')
    ? params.get('szenario')
    : 'morgen';
  const scenario = SCENARIOS[scenarioName];
  const selfUrl = `?szenario=${encodeURIComponent(scenarioName)}`;

  if (params.has('neu')) {
    // A fresh session: forget every scenario's completions and keep the URL reload-safe.
    store.clear();
    history.replaceState(null, '', selfUrl);
  }

  const head = document.getElementById('kopf');
  const content = document.getElementById('aufgaben');
  const notice = document.getElementById('meldung');
  const noticeText = document.getElementById('meldung-text');

  if (store.get(`${scenarioName}:start`, null) === null)
    store.set(`${scenarioName}:start`, Date.now());

  function clock() {
    const elapsed = Math.floor(
      (Date.now() - store.get(`${scenarioName}:start`, Date.now())) / 60_000,
    );
    const minutes = (CLOCK_START_MIN + elapsed) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function pageHead(withTools) {
    return h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Heute'), h('p', { class: 'page-date' }, PAGE_DATE)),
      withTools
        ? h(
            'div',
            { class: 'page-tools' },
            h('span', { class: 'status-line' }, icon('clock'), `Stand ${clock()}`),
            h('a', { class: 'btn btn-secondary', href: selfUrl }, 'Aktualisieren'),
          )
        : null,
    );
  }

  function completeButton(t) {
    let inFlight = false;
    const button = h(
      'button',
      { class: 'btn btn-outline', type: 'button', 'aria-label': `Erledigt: ${t.title}` },
      icon('check'),
      'Erledigt',
    );
    button.addEventListener('click', () => {
      // A second activation while pending does nothing (DESIGN.md §7).
      if (inFlight) return;
      inFlight = true;
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
      // The visible label stays part of the accessible name while pending (WCAG 2.5.3).
      button.setAttribute('aria-label', `Wird gespeichert …: ${t.title}`);
      button.replaceChildren('Wird gespeichert …');
      setTimeout(() => {
        store.set(`${scenarioName}:done`, [...store.get(`${scenarioName}:done`, []), t.id]);
        renderList();
        say('Der Rückruf ist als erledigt markiert.');
      }, PENDING_MS);
    });
    return button;
  }

  function taskRow(t) {
    const unavailable = (scenario.unavailable ?? []).includes(t.id);
    return h(
      'li',
      { class: t.urgent ? 'task task--urgent' : 'task', 'data-task-id': t.id },
      h(
        'article',
        { 'aria-labelledby': `${t.id}-t` },
        h(
          'div',
          { class: 'cell-title' },
          t.urgent ? h('span', { class: 'badge badge--urgent' }, icon('alert'), 'Dringend') : null,
          h('h3', { id: `${t.id}-t` }, t.title),
        ),
        h(
          'dl',
          { class: 'cell-status' },
          h('dt', { class: 'visually-hidden' }, 'Status'),
          h('dd', {}, h('span', { class: 'badge badge--neutral' }, 'Offen')),
        ),
        h(
          'dl',
          { class: 'cell-phone' },
          h('dt', { class: 'visually-hidden' }, 'Anrufer'),
          h('dd', {}, h('a', { class: 'phone', href: `tel:${t.phone}` }, icon('phone'), t.phone)),
        ),
        h(
          'dl',
          { class: 'cell-time' },
          h('dt', {}, 'Eingegangen'),
          h('dd', {}, h('time', { datetime: t.iso }, t.at)),
        ),
        h(
          'div',
          { class: unavailable ? 'cell-action cell-action--unavailable' : 'cell-action' },
          unavailable
            ? h(
                'p',
                { class: 'unavailable', 'data-testid': 'complete-unavailable' },
                icon('warn'),
                'Erledigt ist gerade nicht möglich. Bitte laden Sie die Ansicht in einigen Minuten neu.',
              )
            : completeButton(t),
        ),
      ),
    );
  }

  function panel(key, label, tasks) {
    return h(
      'section',
      { class: 'panel', 'aria-labelledby': `s-${key}` },
      h(
        'div',
        { class: 'panel-head' },
        key === 'urgent' ? icon('alert') : null,
        h('h2', { id: `s-${key}` }, label),
        h(
          'span',
          { class: 'count' },
          String(tasks.length),
          h('span', { class: 'visually-hidden' }, tasks.length === 1 ? ' Aufgabe' : ' Aufgaben'),
        ),
      ),
      h(
        'div',
        { class: 'colhead', 'aria-hidden': 'true' },
        ...['Aufgabe', 'Status', 'Anrufer', 'Eingegangen', ''].map((c) => h('span', {}, c)),
      ),
      h('ul', { class: 'tasks' }, tasks.map(taskRow)),
    );
  }

  function quiet(sections) {
    return h(
      'div',
      { class: 'quiet panel' },
      sections.map(([key, label]) =>
        h(
          'section',
          { 'aria-labelledby': `s-${key}` },
          h('h2', { id: `s-${key}` }, label),
          h('p', { class: 'empty-line' }, icon('check'), 'Alles erledigt.'),
        ),
      ),
    );
  }

  /** The simulated server read: the scenario's tasks minus the ones completed in this tab. */
  function renderList() {
    const done = new Set(store.get(`${scenarioName}:done`, []));
    const open = scenario.tasks.filter((t) => !done.has(t.id));
    const groups = {
      urgent: open.filter((t) => t.urgent),
      callbacks: open.filter((t) => !t.urgent),
      requests: [],
      appointments: [],
      questions: [],
    };
    const blocks = [];
    let empty = [];
    for (const [key, label] of SECTIONS) {
      if (groups[key].length === 0) {
        empty.push([key, label]);
        continue;
      }
      if (empty.length > 0) blocks.push(quiet(empty));
      empty = [];
      blocks.push(panel(key, label, groups[key]));
    }
    if (empty.length > 0) blocks.push(quiet(empty));
    head.replaceChildren(pageHead(true));
    content.replaceChildren(h('div', { class: 'sections' }, blocks));
  }

  function renderLoading() {
    head.replaceChildren(pageHead(false));
    const skeletonRow = (width) =>
      h(
        'div',
        { class: 'skeleton-row' },
        h(
          'div',
          {},
          h('div', { class: `skeleton skeleton--title ${width}` }),
          h('div', { class: 'skeleton skeleton--line' }),
        ),
        h('div', { class: 'skeleton skeleton--action' }),
      );
    content.replaceChildren(
      h('p', { class: 'status-line', role: 'status' }, 'Aufgaben werden geladen …'),
      h(
        'div',
        { class: 'panel skeleton-panel', 'aria-hidden': 'true' },
        h('div', { class: 'panel-head' }, h('div', { class: 'skeleton skeleton--heading' })),
        skeletonRow('w-45'),
        skeletonRow('w-60'),
        skeletonRow('w-38'),
      ),
    );
  }

  function renderError() {
    head.replaceChildren(pageHead(false));
    content.replaceChildren(
      h(
        'div',
        { class: 'alert alert--warning', role: 'alert' },
        icon('warn'),
        h(
          'div',
          {},
          h(
            'p',
            {},
            'Die Aufgaben konnten gerade nicht geladen werden. Bitte versuchen Sie es gleich noch einmal.',
          ),
          h(
            'div',
            { class: 'alert-actions' },
            h('a', { class: 'btn btn-secondary', href: selfUrl }, 'Neu laden'),
          ),
        ),
      ),
    );
  }

  /** The outcome sentence: outside every task, and it takes focus (the row it came from is gone). */
  function say(message) {
    noticeText.textContent = message;
    notice.hidden = false;
    notice.focus();
  }

  document.documentElement.dataset.version = VERSION;
  if (scenario.failFirst && !store.get(`${scenarioName}:failed-once`, false)) {
    store.set(`${scenarioName}:failed-once`, true);
    renderError();
  } else if (scenario.loading) {
    renderLoading();
    setTimeout(renderList, LOADING_MS);
  } else {
    renderList();
  }
})();
