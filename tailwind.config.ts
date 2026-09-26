import type { Config } from 'tailwindcss'

const config: Config = {
  // Themes are driven by the data-theme attribute the anti-FOUC script in
  // app/layout.tsx writes on <html>, not by a `dark` class — so the `dark:`
  // variant (unused in this codebase) is pointed at the same attribute to
  // keep the two from disagreeing if one is ever added.
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-elevated': 'var(--bg-elevated)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-hover': 'var(--surface-hover)',
        border: {
          DEFAULT: 'var(--border)',
          bright: 'var(--border-bright)',
        },
        ink: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          bright: 'var(--accent-bright)',
        },
        // Magenta counterpart to the cyan accent, for the second series in a
        // chart / secondary emphasis without reaching for a signal colour.
        accent2: {
          DEFAULT: 'var(--accent-2)',
          dim: 'var(--accent-2-dim)',
        },
        // Legible text on top of a filled accent or signal surface. Flips with
        // the theme (near-black in dark, white in light), which is why no page
        // should hardcode a hex for this.
        'on-accent': 'var(--on-accent)',
        buy: {
          DEFAULT: 'var(--buy)',
          dim: 'var(--buy-dim)',
        },
        hold: {
          DEFAULT: 'var(--hold)',
          dim: 'var(--hold-dim)',
        },
        avoid: {
          DEFAULT: 'var(--avoid)',
          dim: 'var(--avoid-dim)',
        },
      },
      fontFamily: {
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['var(--font-manrope)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      boxShadow: {
        panel: 'var(--panel-shadow)',
        glow: '0 0 0 1px var(--accent-dim), 0 0 24px -4px var(--glow)',
        'glow-2': '0 0 0 1px var(--accent-2-dim), 0 0 24px -4px var(--glow-2)',
        tile: 'var(--tile-shadow)',
      },
      backgroundImage: {
        grid: 'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '32px 32px',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        drawArc: {
          from: { strokeDashoffset: 'var(--arc-from, 283)' },
          to: { strokeDashoffset: 'var(--arc-to, 0)' },
        },
        flowPulse: {
          '0%': { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.4s ease-out both',
        marquee: 'marquee 40s linear infinite',
        pulseDot: 'pulseDot 1.8s ease-in-out infinite',
        drawArc: 'drawArc 1.1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        flowPulse: 'flowPulse 1.2s linear infinite',
      },
    },
  },
  plugins: [],
}
export default config
