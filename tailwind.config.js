/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Refined muted gold — replaces the earlier bright indigo.
        // Sophisticated brass tone for CTAs, links, active states.
        brand: {
          50:  '#faf6ee',
          100: '#f4ebd7',
          200: '#e6d3a3',
          300: '#d4b56b',
          400: '#c69d4a',
          500: '#b1863a',
          600: '#946b2e',
          700: '#755425',
          800: '#5a4020',
          900: '#3d2c17',
        },
        // Warm near-black text hierarchy (stone family, kept semantic).
        ink: {
          50:  '#faf9f7',
          100: '#f5f4f0',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#0c0a09',
        },
        // Cream backgrounds for the app canvas.
        canvas: {
          50:  '#faf9f7',
          100: '#f5f4f0',
          200: '#ebe9e2',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        // Layered warm shadows — softer than default Tailwind.
        card:    '0 1px 2px 0 rgb(28 25 23 / 0.04), 0 1px 3px 0 rgb(28 25 23 / 0.06)',
        'card-lg':'0 2px 4px 0 rgb(28 25 23 / 0.04), 0 10px 25px -6px rgb(28 25 23 / 0.10)',
        'card-xl':'0 4px 8px 0 rgb(28 25 23 / 0.05), 0 24px 48px -12px rgb(28 25 23 / 0.14)',
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
    },
  },
  plugins: [],
}
