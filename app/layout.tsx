import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import { TooltipProvider } from '@/components/ui/tooltip';
import { spaceGrotesk } from '@/lib/fonts';
import './globals.css';
import { cn } from "@/lib/utils";

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'AgentWatch — Multi-Agent Session Visualizer',
  description: 'Visualize and debug Claude Code multi-agent sessions',
  icons: {
    icon: '/agentwatch-logo.png',
    shortcut: '/agentwatch-logo.png',
    apple: '/agentwatch-logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full", "dark", geistSans.variable, geistMono.variable, "font-sans", spaceGrotesk.variable)}>
      <body className="h-full bg-background text-foreground antialiased">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('aw-theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}` }}
        />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
