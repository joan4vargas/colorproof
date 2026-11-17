import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // O Web Worker de análise usa MuPDF, que tem top-level await: só funciona em
  // módulo ES (o padrão do Vite para Workers é "iife").
  worker: { format: 'es' },
})
