import { defineConfig } from 'vite';

// Bundles the server (and the shared sim/maps packages) into one Node ESM file.
// Colyseus and other npm dependencies stay external and are installed in the Docker image.
export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: 'src/main.ts',
      output: { entryFileNames: 'main.js', format: 'es' },
    },
  },
  ssr: {
    noExternal: [/^@game\//],
  },
});
