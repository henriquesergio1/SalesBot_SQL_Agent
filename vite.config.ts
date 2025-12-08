import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Removido 'define: process.env' que causava erro de build
  server: {
    host: true, // Permite acesso externo
    port: 80
  }
});