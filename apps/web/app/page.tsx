/**
 * Heute (P13.02, M1 vertical slice): the owner's live tasks, rendered on the server.
 *
 * Every request reads fresh (`force-dynamic`, `no-store`): a reload shows what the database holds
 * now. The page forwards only the session cookie to the API; the organisation comes from that
 * session on the API side, never from anything the browser sends (INV-02). Four visible states
 * (P13.11.01): signed out (with the sign-in link), error (with reload), and the sections, each
 * with its reassuring empty line (P13.02.03) — unless the API truncated the list, when an empty
 * section only means none is shown; loading is `loading.tsx`. A callback card carries the one
 * client island, "Erledigt" (P13.03.02): it acts through the API and re-reads this page. `LiveToday`
 * (P13.02.04) polls the same API read while the tab is visible and re-renders this page when the
 * list changed, so a callback committed after the page opened appears without a reload.
 */

import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, type TodayTask } from '@moin/contracts';
import { t } from '../lib/i18n.ts';
import { ActionNotice, CompleteAction } from './complete-action.tsx';
import { LiveToday } from './live-today.tsx';
import { fingerprintOf } from '../lib/live-today.ts';
import { emptyLine, groupToday } from '../lib/today.ts';
import {
  LOGIN_PATH,
  SECTION_ORDER,
  formatCreatedAt,
  loadToday,
  sectionHeading,
  sectionOf,
  statusLabel,
} from '../lib/today-view.ts';

export const dynamic = 'force-dynamic';

function TaskCard({ task }: { task: TodayTask }) {
  return (
    <li className="task" data-task-id={task.id}>
      <article aria-labelledby={`task-${task.id}`}>
        <h3 id={`task-${task.id}`}>{task.title}</h3>
        <dl>
          {task.callerNumber === null ? null : (
            <>
              <dt>{t('today.caller')}</dt>
              <dd>
                <a href={`tel:${task.callerNumber}`}>{task.callerNumber}</a>
              </dd>
            </>
          )}
          <dt>{t('today.received')}</dt>
          <dd>
            <time dateTime={task.createdAt}>{formatCreatedAt(task.createdAt)}</time>
          </dd>
          <dt>{t('today.status')}</dt>
          <dd>{statusLabel(task.status)}</dd>
        </dl>
        {task.type === 'callback' ? (
          <CompleteAction taskId={task.id} title={task.title} version={task.version} />
        ) : null}
      </article>
    </li>
  );
}

export default async function TodayPage() {
  const jar = await cookies();
  const load = await loadToday(
    jar.get(SESSION_COOKIE_NAME)?.value,
    process.env['OWNER_API_ORIGIN'],
  );

  const grouped =
    load.state === 'ready'
      ? groupToday(load.tasks.map((task) => ({ section: sectionOf(task), task })))
      : null;

  return (
    <main id="inhalt">
      <h1>{t('today.title')}</h1>
      {load.state === 'signed-out' ? (
        <>
          <p>{t('today.signedOut')}</p>
          <a href={LOGIN_PATH}>{t('auth.login')}</a>
        </>
      ) : null}
      {load.state === 'error' ? (
        <>
          <p role="alert">{t('today.error')}</p>
          <a href="/">{t('today.reload')}</a>
        </>
      ) : null}
      {load.state === 'signed-out' ? null : (
        <LiveToday
          fingerprint={load.state === 'ready' ? fingerprintOf(load.tasks, load.truncated) : null}
        />
      )}
      {grouped === null ? null : (
        <>
          <a href="/">{t('today.refresh')}</a>
          <ActionNotice />
          {load.state === 'ready' && load.truncated ? (
            <p role="note">{t('today.truncated')}</p>
          ) : null}
          {SECTION_ORDER.map((section) => (
            <section key={section} aria-labelledby={`section-${section}`}>
              <h2 id={`section-${section}`}>{sectionHeading(section)}</h2>
              {grouped[section].length === 0 ? (
                <p>
                  {load.state === 'ready' && load.truncated ? t('today.noneShown') : emptyLine()}
                </p>
              ) : (
                <ul>
                  {grouped[section].map(({ task }) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
