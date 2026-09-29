import type { ReactNode } from 'react';

// The product name is configuration, never a literal (ADR-0034). Until the brand configuration
// loader lands with the owner app in P13, this reads the environment variable that will feed it.
const brandName = process.env['NEXT_PUBLIC_BRAND_NAME'] ?? 'Front Office';

export const metadata = {
  title: brandName,
  description: 'Digitales Front Office für kleine Betriebe',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
