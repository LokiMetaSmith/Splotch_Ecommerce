import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        printshop: resolve(__dirname, 'printshop.html'),
        magiclogin: resolve(__dirname, 'magic-login.html'),
        splotch: resolve(__dirname, 'splotch.html'),
      },
    },
  },
  server: {
    // Expose the server to the network, which can be useful for testing on other devices.
    host: '0.0.0.0'
  }
});
