// NEGATIVE CONTROL for P02.06.07 — never merged.
//
// This file exists to prove that the `verify` workflow's lint step rejects code the ESLint
// configuration forbids. `any` defeats every type-based rule downstream of it, which is why
// `@typescript-eslint/no-explicit-any` is an error rather than a warning.
export const control: any = 1;
