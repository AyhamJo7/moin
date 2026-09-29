// Violates: moin/no-tenant-conditional (INV-18)
export function greeting(organisationId: string): string {
  if (organisationId === 'org_gurlitt') {
    return 'Gurlitt special';
  }
  return 'default';
}
