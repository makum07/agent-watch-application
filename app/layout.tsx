import type { Metadata } from 'next';
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";

const spaceGrotesk = Space_Grotesk({subsets:['latin'],variable:'--font-sans'});

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full", "dark", geistSans.variable, geistMono.variable, "font-sans", spaceGrotesk.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('aw-theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}`}} />
      </head>
      <body className="h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
