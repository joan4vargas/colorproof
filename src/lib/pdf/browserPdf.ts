// Ligação do renderizador de PDF ao navegador: pdf.js com Web Worker próprio
// do pacote (empacotado pelo Vite) e canvas do DOM.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { analyzePdf, type AnalyzePdfOptions, type PdfAnalysis } from './analyzePdf';
import type { MuPdf } from './cmykPdf';
import { renderPdfPages, type CanvasLike, type RenderedPdf } from './renderPdf';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function createDomCanvas(width: number, height: number): CanvasLike {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    get width() {
      return canvas.width;
    },
    get height() {
      return canvas.height;
    },
    getContext: () => canvas.getContext('2d', { willReadFrequently: true }),
  } as CanvasLike;
}

/** O MuPDF (~10 MB de WASM) só é baixado quando um PDF é analisado. */
const loadMupdfInBrowser = (): Promise<MuPdf> => import('mupdf');

/** PDF -> cores dominantes, escolhendo o caminho RGB (pdf.js) ou CMYK (MuPDF + perfil). */
export function analyzePdfInBrowser(file: ArrayBuffer, options: AnalyzePdfOptions = {}): Promise<PdfAnalysis> {
  return analyzePdf(file, { rgb: { pdfjs, createCanvas: createDomCanvas }, loadMupdf: loadMupdfInBrowser }, options);
}

export function renderPdfInBrowser(
  file: ArrayBuffer,
  options: { scale?: number; maxPages?: number; maxPixelsPerPage?: number } = {},
): Promise<RenderedPdf> {
  return renderPdfPages(file, { ...options, pdfjs, createCanvas: createDomCanvas });
}

/** Rasteriza uma imagem (PNG, JPEG...) para pixels RGBA em sRGB, limitada a `maxPixels`. */
export async function rasterizeImageInBrowser(
  file: Blob,
  maxPixels = 4_000_000,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'default' });
  try {
    const factor = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.floor(bitmap.width * factor));
    const height = Math.max(1, Math.floor(bitmap.height * factor));
    const canvas = createDomCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível criar o contexto 2D.');
    // Fundo branco opaco: transparência vira papel, como no PDF.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    (ctx as unknown as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}
