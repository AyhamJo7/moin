/**
 * Placeholder home route (P13.11.02 phone-first shell).
 *
 * Max-width steps at the 360 / 768 / 1280 px layout tokens; the owner views
 * ride on this shell.
 */
export default function Home() {
  return (
    <main
      style={{
        marginInline: 'auto',
        width: '100%',
        maxWidth: 360,
        paddingInline: 16,
      }}
    >
      <h1>Front Office</h1>
      <p>Die Owner-App entsteht in Phase P13.</p>
      <style>{`@media (min-width: 768px) { main { max-width: 768px; } }
@media (min-width: 1280px) { main { max-width: 1280px; } }`}</style>
    </main>
  );
}
