/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          pink: '#E83E8C',
          dark: '#1A1A2E',
          light: '#FFF5F9',
        },
        anime: '#9B59B6',
        movie: '#3498DB',
        game: '#F39C12',
        software: '#F1C40F',
        website: '#1ABC9C',
        book: '#E74C3C',
      },
      fontFamily: {
        sans: ['Noto Sans SC', 'Space Grotesk', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Noto Sans SC', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
