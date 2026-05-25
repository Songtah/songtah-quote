import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── shadcn/ui + Magic UI CSS 變數色票 ──────────────────
        background:  'var(--background)',
        foreground:  'var(--foreground)',
        primary: {
          DEFAULT:    'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT:    'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT:    'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT:    'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: { DEFAULT: 'var(--destructive)' },
        border:  'var(--border)',
        input:   'var(--input)',
        ring:    'var(--ring)',
        card: {
          DEFAULT:    'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT:    'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        // ── 崧達品牌色票 ────────────────────────────────────────
        brand: {
          50:  '#faf7f2',
          100: '#f3ede3',
          200: '#e8dfd0',
          300: '#d4c5ab',
          400: '#c4a87a',
          500: '#b8956a',
          600: '#a07a52',
          700: '#866245',
          800: '#6e503c',
          900: '#5a4233',
        },
        gold: {
          50:  '#fdf9ef',
          100: '#f9f0d5',
          200: '#f2dfa8',
          300: '#e9c96f',
          400: '#e2b44a',
          500: '#d49a2a',
          600: '#b87a1e',
          700: '#995b1b',
          800: '#7d491d',
          900: '#683d1c',
        },
        cream: {
          50:  '#fefdfb',
          100: '#faf6f0',
          200: '#f5efe5',
          300: '#ede4d4',
          400: '#e0d3bd',
          500: '#d1bfa3',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      animation: {
        beam:       'beam 10s ease-in-out infinite',
        'fade-in':  'fadeIn 0.8s ease-out forwards',
        'slide-up': 'slideUp 0.6s ease-out forwards',
        shimmer:    'shimmer 3s ease-in-out infinite',
        // Magic UI
        marquee:         'marquee var(--duration) infinite linear',
        'marquee-vertical': 'marquee-vertical var(--duration) linear infinite',
        'border-beam':   'border-beam calc(var(--duration)*1s) infinite linear',
        ripple:          'ripple var(--duration, 2s) ease calc(var(--i, 0) * 0.2s) infinite',
        meteor:          'meteor 5s linear infinite',
        grid:            'grid 15s linear infinite',
        orbit:           'orbit calc(var(--duration)*1s) linear infinite',
        'spin-around':   'spin-around calc(var(--speed)*2) infinite linear',
        slide:           'slide var(--speed) ease-in-out infinite alternate',
        pulse:           'pulse var(--duration) ease-out infinite',
      },
      keyframes: {
        beam: {
          '0%, 100%': { opacity: '0.2', transform: 'translateY(0)' },
          '50%':      { opacity: '0.5', transform: 'translateY(-4%)' },
        },
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '0%, 100%': { opacity: '0.4' }, '50%': { opacity: '0.8' } },
        // Magic UI keyframes
        marquee:          { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(calc(-100% - var(--gap)))' } },
        'marquee-vertical': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(calc(-100% - var(--gap)))' } },
        'border-beam':    { '100%': { 'offset-distance': '100%' } },
        ripple:           { '0%, 100%': { transform: 'translate(-50%, -50%) scale(1)' }, '50%': { transform: 'translate(-50%, -50%) scale(0.9)' } },
        meteor:           { '0%': { transform: 'rotate(215deg) translateX(0)', opacity: '1' }, '70%': { opacity: '1' }, '100%': { transform: 'rotate(215deg) translateX(-500px)', opacity: '0' } },
        grid:             { '0%': { transform: 'translateY(-50%)' }, '100%': { transform: 'translateY(0)' } },
        orbit:            { '0%': { transform: 'rotate(0deg) translateY(calc(var(--radius) * 1px)) rotate(0deg)' }, '100%': { transform: 'rotate(360deg) translateY(calc(var(--radius) * 1px)) rotate(-360deg)' } },
        'spin-around':    { '0%': { transform: 'translateZ(0) rotate(0)' }, '15%, 35%': { transform: 'translateZ(0) rotate(90deg)' }, '65%, 85%': { transform: 'translateZ(0) rotate(270deg)' }, '100%': { transform: 'translateZ(0) rotate(360deg)' } },
        slide:            { to: { transform: 'translate(calc(100cqw - 100%), 0)' } },
        pulse:            { '0%, 100%': { boxShadow: '0 0 0 0 var(--pulse-color)' }, '50%': { boxShadow: '0 0 0 8px var(--pulse-color)' } },
      },
    },
  },
  plugins: [],
}
export default config
