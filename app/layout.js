export const metadata = {
  title: 'Komal Amin | Builder at the intersection of AI, product, and growth',
  description: 'Founder and builder shipping products in public across AI, product, and growth.'
};

import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
