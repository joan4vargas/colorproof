// Fase 4: PDF -> pixels.
//
// Decisão de projeto: cada página é rasterizada com o pdf.js e as cores são
// lidas dos pixels. Isso captura tudo o que aparece na página (imagens,
// vetores, texto, transparências) com um único caminho de código. O custo é
// que o pdf.js entrega sRGB: cores CMYK e fora do gamut do sRGB já chegam
// convertidas/recortadas (docs, seção 9, limitação L13). A alternativa,
// ler os operadores de cor do PDF, preservaria o CMYK, mas exige um
// interpretador de content stream próprio e fica como trabalho futuro.
//
// Este módulo não importa o pdf.js nem cria canvas por conta própria: quem
// chama injeta os dois. No navegador use `browserPdf.ts`; nos testes em Node,
// o build "legacy" do pdf.js e o @napi-rs/canvas.

import type { PDFDocumentProxy } from 'pdfjs-dist';

/** O mínimo do pdf.js que este módulo usa. */
export interface PdfLib {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PDFDocumentProxy> };
}

export interface CanvasContextLike {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasContextLike | null;
}

export interface RenderOptions {
  pdfjs: PdfLib;
  createCanvas: (width: number, height: number) => CanvasLike;
  /** Pixels por ponto do PDF (1 pt = 1/72 pol). Padrão 1,5 (cerca de 108 dpi). */
  scale?: number;
  /** Só as primeiras páginas, para limitar tempo e memória (padrão 10). */
  maxPages?: number;
  /** A escala é reduzida se a página passar deste total de pixels (padrão 4 milhões). */
  maxPixelsPerPage?: number;
}

export interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  /** RGBA, sRGB, sobre fundo branco opaco. */
  data: Uint8ClampedArray;
}

export interface RenderedPdf {
  /** Total de páginas do arquivo, mesmo que só parte tenha sido renderizada. */
  numPages: number;
  pages: RenderedPage[];
}

export async function renderPdfPages(
  file: ArrayBuffer | Uint8Array,
  options: RenderOptions,
): Promise<RenderedPdf> {
  const { pdfjs, createCanvas, scale = 1.5, maxPages = 10, maxPixelsPerPage = 4_000_000 } = options;

  // O pdf.js assume a posse do buffer; copiamos para não invalidar o do chamador.
  const data = new Uint8Array(file instanceof Uint8Array ? file : new Uint8Array(file)).slice();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: RenderedPage[] = [];
    const last = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= last; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale });
      const pixels = base.width * base.height;
      const effective = pixels > maxPixelsPerPage ? scale * Math.sqrt(maxPixelsPerPage / pixels) : scale;
      const viewport = page.getViewport({ scale: effective });

      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('renderPdfPages: não foi possível criar o contexto 2D.');

      // Papel branco opaco: sem alfa, o getImageData não distorce as cores
      // (pré-multiplicação) e "papel" fica bem definido.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      pages.push({ pageNumber: n, width, height, data: ctx.getImageData(0, 0, width, height).data });
      page.cleanup();
    }
    return { numPages: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}

/** Junta os pixels de várias páginas num único buffer RGBA. */
export function concatPages(pages: RenderedPage[]): Uint8ClampedArray {
  const total = pages.reduce((s, p) => s + p.data.length, 0);
  const out = new Uint8ClampedArray(total);
  let offset = 0;
  for (const p of pages) {
    out.set(p.data, offset);
    offset += p.data.length;
  }
  return out;
}
