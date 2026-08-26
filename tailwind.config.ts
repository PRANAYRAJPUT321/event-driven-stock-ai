import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        'primary-dark': '#1E40AF',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        neutral: '#6B7280',
      },
    },
  },
  plugins: [],
}
export default config
