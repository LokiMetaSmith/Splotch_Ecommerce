import { defineConfig } from 'vite';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
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
  server: {
    // Expose the server to the network, which can be useful for testing on other devices.
    host: '0.0.0.0'
  }
});
