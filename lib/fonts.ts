import { Space_Grotesk } from 'next/font/google';

// Shared module-scope font loader instance — next/font requires the loader call itself to live
// at module scope, so this is imported both by the root layout (for the --font-sans variable)
// and by anything that wants the font's `.className` directly (see navbar-brand.tsx: the
// `--font-sans` theme variable in globals.css is circular (`--font-sans: var(--font-sans)`) and
// never actually resolves, so `font-sans` silently falls back to the system font everywhere —
// going through `.className` here sidesteps that bug rather than depending on it being fixed).
export const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans' });
