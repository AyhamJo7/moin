import { t } from '../lib/i18n.ts';

/** Loading state of Heute (P13.11.01): announced politely while the server reads the API. */
export default function Loading() {
  return (
    <main id="inhalt">
      <h1>{t('today.title')}</h1>
      <p role="status">{t('today.loading')}</p>
    </main>
  );
}
