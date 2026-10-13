import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({ root: path.resolve('./client'), plugins: [react()], server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } }, build: { outDir: '../dist', emptyOutDir: true } });
