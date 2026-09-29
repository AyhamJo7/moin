// Violates: moin/no-direct-db-access (INV-01, INV-02)
declare const db: { query: (text: string) => Promise<unknown> };

export async function listTasks(): Promise<unknown> {
  return db.query('select * from tasks');
}
