import type { ReactNode } from 'react';
import { t } from '../lib/i18n.ts';

// The product name is configuration, never a literal (ADR-0034). Until the brand configuration
// loader lands with the owner app in P13, this reads the environment variable that will feed it.
const brandName = process.env['NEXT_PUBLIC_BRAND_NAME'] ?? 'Front Office';

export const metadata = {
  title: brandName,
  description: 'Digitales Front Office für kleine Betriebe',
  manifest: '/manifest.webmanifest',
};

/**
 * Phone-first shell (P13.11.02, P13.12.01 a11y floor), shared by every owner view and its loading
 * state: skip link, German nav with a visible focus ring, 44 px targets, and max-width steps at
 * the 360 / 768 / 1280 px layout tokens. Only Heute is built (M1); the other areas arrive with
 * their P13 sections.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <a href="#inhalt" className="skip-link">
          {t('nav.skip')}
        </a>
        <header>
          <nav aria-label={t('nav.label')}>
            <ul>
              <li>
                <a href="/" aria-current="page">
                  {t('nav.today')}
                </a>
              </li>
            </ul>
          </nav>
        </header>
        {children}
        <style>{`main { margin-inline: auto; width: 100%; max-width: 360px; padding-inline: 16px; box-sizing: border-box; }
@media (min-width: 768px) { main { max-width: 768px; } }
@media (min-width: 1280px) { main { max-width: 1280px; } }
.skip-link { position: absolute; left: 8px; top: -48px; min-height: 44px; background: #fff; padding: 8px 12px; z-index: 1; }
.skip-link:focus-visible { top: 8px; outline: 3px solid #000; outline-offset: 2px; }
nav a, main a { display: inline-block; min-height: 44px; min-width: 44px; line-height: 44px; }
a:focus-visible { outline: 3px solid #000; outline-offset: 2px; }
.task { border: 1px solid #555; border-radius: 6px; padding: 8px 12px; margin-block: 8px; }
.task h3 { margin-block: 4px; font-size: 1.05rem; }
.task dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; }
.task dd { margin: 0; }
.action { min-height: 44px; min-width: 44px; margin-block: 8px; padding: 8px 16px; font: inherit; border: 2px solid #000; border-radius: 6px; background: #fff; color: #000; cursor: pointer; }
.action[aria-disabled="true"] { cursor: progress; opacity: 0.7; }
.action:focus-visible { outline: 3px solid #000; outline-offset: 2px; }
.notice:empty { display: none; }`}</style>
      </body>
    </html>
  );
}
