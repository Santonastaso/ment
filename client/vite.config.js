import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('react-force-graph-2d')) return 'force-graph';
          if (id.includes('react-router-dom')) return 'router';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('@base-ui')) return 'base-ui';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react';
        },
      },
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
  },
});
