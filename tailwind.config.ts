// Brand color from penguinai-claude-artifacts-main; rest of palette is placeholder. See ARTIFACTS_MAP.md.
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#fc459d',
        'primary-foreground': '#ffffff',
        surface: '#ffffff',
        'surface-foreground': '#0f172a',
        muted: '#f1f5f9',
        'muted-foreground': '#64748b',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        border: '#e2e8f0',
        ring: '#fc459d',
      },
      fontSize: {
        display: ['3rem', { lineHeight: '1.1' }],
        h1: ['2.25rem', { lineHeight: '1.2' }],
        h2: ['1.875rem', { lineHeight: '1.3' }],
        body: ['1rem', { lineHeight: '1.5' }],
        small: ['0.875rem', { lineHeight: '1.5' }],
      },
    },
  },
  plugins: [],
}

export default config
