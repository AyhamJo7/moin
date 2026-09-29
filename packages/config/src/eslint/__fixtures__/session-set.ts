// Violates: no-restricted-syntax (session-level SET leaks onto the next pooled checkout)
export const setTenant = 'SET app.organisation_id = $1';
export const setTenantTemplate = `SET SESSION app.organisation_id = '${'x'}'`;
