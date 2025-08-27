/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./printshop.html",
    "./magic-login.html",
    "./orders.html",
    "./status.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'splotch-red': '#FF003A',
        'splotch-yellow': '#FFD151',
        'splotch-teal': '#00A99D',
        'splotch-navy': '#2A284D',
        'splotch-white': '#FFFFFF',
        'splotch-black': '#000000',
      },
      fontFamily: {
        modak: ['Modak', 'cursive'],
        baumans: ['Baumans', 'sans-serif'],
        monofett: ['Monofett', 'cursive'],
      },
    },
  },
  plugins: [],
}
