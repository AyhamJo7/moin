// Violates: no-restricted-syntax (SQL built by template interpolation)
export function findContact(phone: string): string {
  return `SELECT * FROM contacts WHERE phone = '${phone}'`;
}
