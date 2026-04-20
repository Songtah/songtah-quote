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
      animation: {
        beam: 'beam 10s ease-in-out infinite',
        'fade-in': 'fadeIn 0.8s ease-out forwards',
        'slide-up': 'slideUp 0.6s ease-out forwards',
        shimmer: 'shimmer 3s ease-in-out infinite',
      },
      keyframes: {
        beam: {
          '0%, 100%': { opacity: '0.2', transform: 'translateY(0)' },
          '50%': { opacity: '0.5', transform: 'translateY(-4%)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
}
export default config
