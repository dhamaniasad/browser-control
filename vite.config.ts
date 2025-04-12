import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin'; // Use the new plugin
import manifest from './manifest.json'; // Import the manifest directly

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }), // Pass the imported manifest to the crx plugin
  ],
  // Optional: Configure server port if needed for development
  // server: {
  //   port: 3000,
  // },
  // Configure build output directory (default is 'dist')
  build: {
    outDir: 'dist',
    sourcemap: true, // Enable sourcemaps for debugging
    rollupOptions: {
      // Optional: Configure input if not automatically handled by crx plugin
      // input: {
      //   sidepanel: 'index.html', // Assuming index.html is the side panel entry
      // },
    },
  },
});
