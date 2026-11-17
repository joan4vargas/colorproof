// Web Worker de análise (Fase 5): roda pdf.js, MuPDF e lcms2 fora da thread da
// interface, para a tela não travar durante a leitura de um PDF.
//
// Este arquivo só liga o navegador à lógica de `analysisHandler.ts`:
//  - canvas: OffscreenCanvas (no Worker não existe `document`);
//  - pdf.js: o mesmo pacote, com o seu worker próprio;
//  - MuPDF: import dinâmico (o WASM de ~10 MB só baixa quando preciso);
//  - lcms2: o `.wasm` vem do Vite por `?url`.

/// <reference lib="webworker" />

import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import lcmsWasmUrl from 'lcms-wasm/dist/lcms.wasm?url';
import { createAnalysisHandler } from '../lib/analysis/analysisHandler';
import type { WorkerRequest, WorkerResponse } from '../lib/analysis/protocol';
import { createColorEngine } from '../lib/icc/colorEngine';
import type { CanvasLike } from '../lib/pdf/renderPdf';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function createOffscreenCanvas(width: number, height: number): CanvasLike {
  const canvas = new OffscreenCanvas(width, height);
  return {
    get width() {
      return canvas.width;
    },
    get height() {
      return canvas.height;
    },
    getContext: () => canvas.getContext('2d', { willReadFrequently: true }),
  } as unknown as CanvasLike;
}

async function rasterizeImage(bytes: ArrayBuffer, mime: string, maxPixels = 4_000_000) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), {
    colorSpaceConversion: 'default',
  });
  try {
    const factor = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.floor(bitmap.width * factor));
    const height = Math.max(1, Math.floor(bitmap.height * factor));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Não foi possível criar o contexto 2D.');
    // Fundo branco opaco: transparência vira papel, como no PDF.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

const handle = createAnalysisHandler(
  {
    createEngine: () => createColorEngine({ wasmUrl: lcmsWasmUrl }),
    deps: {
      rgb: { pdfjs, createCanvas: createOffscreenCanvas },
      loadMupdf: () => import('mupdf'),
    },
    rasterizeImage,
  },
  (response: WorkerResponse) => self.postMessage(response),
);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
};
