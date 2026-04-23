import { defineConfig } from 'vite';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';

const packageJson = JSON.parse(fs.readFileSync('./package.json'));
process.env.VITE_APP_VERSION = packageJson.version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [
    basicSsl()
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        printshop: resolve(__dirname, 'printshop.html'),
        magiclogin: resolve(__dirname, 'magic-login.html'),
        orders: resolve(__dirname, 'orders.html'),
        status: resolve(__dirname, 'status.html'),
      },
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
