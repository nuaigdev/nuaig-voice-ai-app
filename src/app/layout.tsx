import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono, Unbounded } from 'next/font/google';
import { getActiveClient } from '@/clients';
import { PRODUCT } from '@/config/product';
import { ClientConfigProvider } from '@/components/providers/ClientConfigProvider';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

// Display face reserved for the NuVA wordmark, so the product name never reads as UI text.
const display = Unbounded({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export function generateMetadata(): Metadata {
  const client = getActiveClient();
  return {
    title: `${PRODUCT.name} · ${client.name}`,
    description: `${PRODUCT.name} ${PRODUCT.descriptor} for ${client.name}, built by ${PRODUCT.vendor.name}.`,
    icons: client.icon ? { icon: client.icon, apple: client.icon } : undefined,
  };
}

// Applies the saved theme before first paint so dark-mode users don't see a light flash.
const themeScript = `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const client = getActiveClient();
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ClientConfigProvider client={client}>{children}</ClientConfigProvider>
      </body>
    </html>
  );
}
