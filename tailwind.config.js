/** @type {import('tailwindcss').Config} */
export default {
  // Touch devices keep :hover applied after a tap, which left tapped controls
  // looking selected. This confines every hover: variant to pointers.
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      spacing: {
        'safe-top': 'var(--safe-top)',
        'safe-right': 'var(--safe-right)',
        'safe-bottom': 'var(--safe-bottom)',
        'safe-left': 'var(--safe-left)',
        'inset-top': 'var(--inset-top)',
        'inset-right': 'var(--inset-right)',
        'inset-bottom': 'var(--inset-bottom)',
        'inset-left': 'var(--inset-left)',
        // Clears the floating hamburger/theme row above scrolling page content.
        'header': 'calc(var(--safe-top) + 4rem)',
        'header-lg': 'calc(var(--safe-top) + 5rem)',
        // Reader bottom dock, grown by the home-indicator inset.
        'dock': 'calc(5rem + var(--safe-bottom))',
      },
      fontFamily: {
        mono: ['"Roboto Mono"', 'monospace'],
      },
      colors: {
        // Volcanic (Night)
        basalt: 'var(--color-basalt)',
        'magma-vent': 'var(--color-magma-vent)',
        'magma-crust': 'var(--color-magma-crust)',
        'canarian-pine': 'var(--color-canarian-pine)',

        // Dunes (Day)
        'dune-gold': 'var(--color-dune-gold)',
        'dune-shadow': 'var(--color-dune-shadow)',
        'calima-haze': 'var(--color-calima-haze)',
        'atlantic-blue': 'var(--color-atlantic-blue)',

        // Yumbo (Psychedelic)
        'neon-pride': 'var(--color-neon-pride)',
        'bio-cyan': 'var(--color-bio-cyan)',
        'mojo-lime': 'var(--color-mojo-lime)',
      },
      animation: {
        'magma-breath': 'magmaBreath 6s cubic-bezier(0.4, 0.0, 0.2, 1) infinite',
        'alisios-wind': 'alisiosWind 40s linear infinite',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
      },
      keyframes: {
        magmaBreath: {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 10px var(--color-magma-crust)' },
          '50%': { transform: 'scale(1.03)', boxShadow: '0 0 30px var(--color-magma-vent)' },
        },
        alisiosWind: {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '100% 20%' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        }
      }
    },
  },
  plugins: [],
}

