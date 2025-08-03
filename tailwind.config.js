// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html', // This will scan index.html, printshop.html, etc.
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'splotch-red': '#FF003A',
        'splotch-yellow': '#FFD151',
        'splotch-teal': '#00A99D',
        'splotch-navy': '#2A284D',
      },
      fontFamily: {
        'modak': ['Modak', 'cursive'],
        'baumans': ['Baumans', 'sans-serif'],
        'monofett': ['Monofett', 'cursive'],
      },
    },
  },
  plugins: [],
}