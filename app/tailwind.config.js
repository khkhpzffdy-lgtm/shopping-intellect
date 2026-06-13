/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f5efe2',
        ink: '#1e2b28',
        pine: '#20413a',
        sand: '#ece2ce',
        coral: '#c96a43'
      },
      boxShadow: {
        shell: '0 24px 60px rgba(32, 65, 58, 0.12)'
      }
    }
  },
  plugins: []
};
