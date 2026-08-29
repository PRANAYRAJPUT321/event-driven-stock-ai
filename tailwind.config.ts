import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
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
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 40px -20px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px var(--accent-dim), 0 0 24px -4px var(--accent)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(230,233,240,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(230,233,240,0.035) 1px, transparent 1px)',
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
