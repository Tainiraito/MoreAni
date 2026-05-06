/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'primary-pink': '#F783AC',
        'primary-light': '#FFF0F5',
        'primary-dark': '#E05A8A',
        'primary-yellow': '#E8B84B',
        'primary-purple': '#B490E4',
        'purple-light': '#F3EEFF',
        'accent-gold': '#FFD700',
        'text-primary': '#2D2D2D',
        'text-body': '#5A5A5A',
        'text-secondary': '#9A9A9A',
        'bg-white': '#FFFFFF',
        'bg-page': '#FAF8FB',
        'bg-noise-start': '#FFF5F7',
        'bg-noise-end': '#F5EFFF'
      },
      fontFamily: {
        sans: ['"Source Han Serif CN"', 'Georgia', 'serif']
      },
      fontWeight: {
        normal: '500',
        medium: '500',
        semibold: '600',
        bold: '700'
      },
      borderRadius: {
        8: '8px',
        12: '12px'
      },
      fontSize: {
        hero: ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        section: ['22px', { lineHeight: '1.3', fontWeight: '600' }],
        'card-title': ['18px', { lineHeight: '1.4', fontWeight: '600' }],
        body: ['15px', { lineHeight: '1.6', fontWeight: '500' }],
        small: ['13px', { lineHeight: '1.5', fontWeight: '500' }]
      }
    }
  },
  plugins: []
}
