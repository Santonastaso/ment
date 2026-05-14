/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Navy — anchor of the trust palette. Banking/fintech association.
        navy: {
          DEFAULT: '#1B3A5C',
          light: '#2E75B6',
          dark: '#142C45',  // slightly deeper than before for richer hover
        },
        // Slate-based "ink" — text and structural elements. Cooler than warm
        // grays; reads as "considered, professional" rather than "cozy".
        ink: {
          DEFAULT: '#0F172A',    // slate-900 — primary text
          secondary: '#475569',  // slate-600
          tertiary: '#94A3B8',   // slate-400
          placeholder: '#CBD5E1', // slate-300
        },
        // Surface tokens — backgrounds and borders.
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F8FAFC',  // slate-50 — page background
          subtle: '#F1F5F9', // slate-100 — secondary surfaces
          border: '#E2E8F0', // slate-200
        },
        // Single warm accent — used sparingly for "this moment is special".
        gold: {
          DEFAULT: '#F59E0B', // amber-500
          soft: '#FEF3C7',    // amber-100
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        // Used on uppercase labels — small tracking adds polish.
        label: '0.06em',
      },
      transitionDuration: {
        // Calmer default for hover/focus. Linear/Stripe live in the ~150ms zone.
        DEFAULT: '150ms',
      },
    }
  },
  plugins: []
};
