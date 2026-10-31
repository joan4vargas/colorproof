// Caminho CMYK do híbrido: lê os números C, M, Y, K do PDF sem passar por RGB.
//
// O pdf.js só entrega sRGB e converte CMYK de forma aproximada (docs, seção 8).
// Aqui usamos o MuPDF (WASM), que compõe a página direto em CMYK. Duas
// escolhas importantes:
//
// 1. O ICC do MuPDF é DESLIGADO durante a leitura. Com ele ligado, um PDF que
//    declara um perfil CMYK embutido (ICCBased) tem os valores convertidos para
//    o CMYK padrão do MuPDF e deixa de trazer os números do arquivo (medido:
//    ciano 100% virou 255/31/4/0). Desligado, os números lidos são os do arquivo,
//    e quem dá o significado deles é o perfil escolhido pelo usuário, que é o
//    que o Fluxo A pretende simular. O perfil embutido no PDF é ignorado.
// 2. Elementos em RGB ou cinza dentro de um PDF com CMYK são convertidos pelo
//    MuPDF para CMYK, sem perfil. Por isso `inspectPdfColorUsage` conta o que o
//    arquivo pinta, e o chamador avisa quando o PDF é misto.
//
// Licença: o MuPDF é AGPL-3.0 (docs, seção 8). O módulo não o importa: quem
// chama injeta, o que também mantém o WASM (~10 MB) fora do carregamento
// inicial e permite carregá-lo só quando for preciso.

import type * as MuPdfNs from 'mupdf';

export type MuPdf = typeof MuPdfNs;

/** Contagem de operações de pintura por tipo de espaço de cor. */
export interface ColorUsage {
  cmyk: number;
  rgb: number;
  gray: number;
  /** Degradês (shadings), Lab, indexadas, spot... */
  other: number;
}

export interface PdfColorUsage {
  numPages: number;
  /** Uso nas páginas inspecionadas, na ordem. */
  pages: ColorUsage[];
  total: ColorUsage;
  hasCmyk: boolean;
  hasRgb: boolean;
}

export interface CmykRenderOptions {
  /** Pixels por ponto do PDF. Padrão 1,5, como no caminho RGB. */
  scale?: number;
  maxPages?: number;
  maxPixelsPerPage?: number;
}

export interface RenderedCmykPage {
  pageNumber: number;
  width: number;
  height: number;
  /** CMYK, 4 bytes por pixel; 255 = 100% de tinta; papel = 0/0/0/0. */
  data: Uint8ClampedArray;
}

export interface RenderedCmykPdf {
  numPages: number;
  pages: RenderedCmykPage[];
}

const emptyUsage = (): ColorUsage => ({ cmyk: 0, rgb: 0, gray: 0, other: 0 });

function openPdf(mupdf: MuPdf, file: ArrayBuffer | Uint8Array) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  // Cópia: o MuPDF pode reter o buffer e o chamador continua dono do dele.
  return mupdf.Document.openDocument(bytes.slice(), 'application/pdf');
}

/** Roda `fn` com o ICC do MuPDF desligado e religa depois (estado global da biblioteca). */
function withoutIcc<T>(mupdf: MuPdf, fn: () => T): T {
  mupdf.disableICC();
  try {
    return fn();
  } finally {
    mupdf.enableICC();
  }
}

/**
 * Percorre as páginas com um "dispositivo" do MuPDF e conta o que é pintado em
 * cada espaço de cor. Serve para decidir o caminho (RGB ou CMYK) e para avisar
 * quando o arquivo mistura os dois.
 */
export function inspectPdfColorUsage(
  mupdf: MuPdf,
  file: ArrayBuffer | Uint8Array,
  maxPages = 10,
): PdfColorUsage {
  const doc = openPdf(mupdf, file);
  try {
    const numPages = doc.countPages();
    const pages: ColorUsage[] = [];
    for (let n = 0; n < Math.min(numPages, maxPages); n++) {
      const usage = emptyUsage();
      const count = (cs: MuPdfNs.ColorSpace | null) => {
        const type = cs ? cs.getType() : 'None';
        if (type === 'CMYK') usage.cmyk += 1;
        else if (type === 'RGB' || type === 'BGR') usage.rgb += 1;
        else if (type === 'Gray') usage.gray += 1;
        else usage.other += 1;
      };
      const device = new mupdf.Device({
        fillPath: (_p, _e, _ctm, cs) => count(cs),
        strokePath: (_p, _s, _ctm, cs) => count(cs),
        fillText: (_t, _ctm, cs) => count(cs),
        strokeText: (_t, _s, _ctm, cs) => count(cs),
        fillImageMask: (_i, _ctm, cs) => count(cs),
        fillImage: (image) => count(image.getColorSpace()),
        fillShade: () => {
          usage.other += 1;
        },
      });
      const page = doc.loadPage(n);
      try {
        page.run(device, mupdf.Matrix.identity);
      } finally {
        device.close();
        device.destroy();
        page.destroy();
      }
      pages.push(usage);
    }
    const total = pages.reduce(
      (s, u) => ({ cmyk: s.cmyk + u.cmyk, rgb: s.rgb + u.rgb, gray: s.gray + u.gray, other: s.other + u.other }),
      emptyUsage(),
    );
    return { numPages, pages, total, hasCmyk: total.cmyk > 0, hasRgb: total.rgb > 0 };
  } finally {
    doc.destroy();
  }
}

/** Rasteriza as páginas direto em CMYK (valores do arquivo, ICC do MuPDF desligado). */
export function renderPdfPagesCmyk(
  mupdf: MuPdf,
  file: ArrayBuffer | Uint8Array,
  options: CmykRenderOptions = {},
): RenderedCmykPdf {
  const { scale = 1.5, maxPages = 10, maxPixelsPerPage = 4_000_000 } = options;
  return withoutIcc(mupdf, () => {
    const doc = openPdf(mupdf, file);
    try {
      const numPages = doc.countPages();
      const pages: RenderedCmykPage[] = [];
      for (let n = 0; n < Math.min(numPages, maxPages); n++) {
        const page = doc.loadPage(n);
        try {
          const [x0, y0, x1, y1] = page.getBounds();
          const pixels = (x1 - x0) * scale * ((y1 - y0) * scale);
          const effective = pixels > maxPixelsPerPage ? scale * Math.sqrt(maxPixelsPerPage / pixels) : scale;
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(effective, effective),
            mupdf.ColorSpace.DeviceCMYK,
            false, // sem alfa: papel = 0/0/0/0
            true,
          );
          try {
            pages.push({
              pageNumber: n + 1,
              width: pixmap.getWidth(),
              height: pixmap.getHeight(),
              data: pixmap.getPixels().slice(), // copia: o original vive na memória do WASM
            });
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      return { numPages, pages };
    } finally {
      doc.destroy();
    }
  });
}

/** Junta os pixels CMYK de várias páginas num único buffer. */
export function concatCmykPages(pages: RenderedCmykPage[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pages.reduce((s, p) => s + p.data.length, 0));
  let offset = 0;
  for (const p of pages) {
    out.set(p.data, offset);
    offset += p.data.length;
  }
  return out;
}
