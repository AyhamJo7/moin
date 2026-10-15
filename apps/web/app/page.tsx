/**
 * Placeholder home route (P13.11.02 phone-first shell, P13.12.01 a11y floor).
 *
 * Max-width steps at the 360 / 768 / 1280 px layout tokens; the owner views
 * ride on this shell. Semantic landmark, skip link, German nav with
 * focus-visible ring; targets meet the 44 px floor.
 */
export default function Home() {
  return (
    <>
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <header>
        <nav aria-label="Hauptbereiche">
          <ul>
            <li>
              <a href="/">Heute</a>
            </li>
            <li>
              <a href="/">Posteingang</a>
            </li>
            <li>
              <a href="/">Kunden</a>
            </li>
            <li>
              <a href="/">Wissen</a>
            </li>
            <li>
              <a href="/">Einstellungen</a>
            </li>
          </ul>
        </nav>
      </header>
      <main
        id="inhalt"
        style={{
          marginInline: 'auto',
          width: '100%',
          maxWidth: 360,
          paddingInline: 16,
        }}
      >
        <h1>Front Office</h1>
        <p>Die Owner-App entsteht in Phase P13.</p>
      </main>
      <style>{`@media (min-width: 768px) { main { max-width: 768px; } }
@media (min-width: 1280px) { main { max-width: 1280px; } }
.skip-link { position: absolute; left: 8px; top: -48px; min-height: 44px; background: #fff; padding: 8px 12px; z-index: 1; }
.skip-link:focus-visible { top: 8px; outline: 3px solid #000; outline-offset: 2px; }
nav a { display: inline-block; min-height: 44px; min-width: 44px; line-height: 44px; }
a:focus-visible { outline: 3px solid #000; outline-offset: 2px; }`}</style>
    </>
  );
}
