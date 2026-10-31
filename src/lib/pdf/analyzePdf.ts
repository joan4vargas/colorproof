// Orquestrador do híbrido (Fase 4): escolhe o caminho de leitura de cor de um PDF.
//
//  - sem CMYK pintado  -> caminho RGB: pdf.js rasteriza em sRGB (exato para RGB);
//  - com CMYK pintado  -> caminho CMYK: MuPDF lê os números C, M, Y, K do
//                         arquivo e o perfil ICC escolhido os leva a Lab.
//
// A detecção usa o MuPDF, então ele é carregado mesmo para PDFs em RGB; por
// isso é injetado por uma função (`loadMupdf`), que no navegador faz o import
// dinâmico e mantém os ~10 MB do WASM fora do carregamento inicial.

import { extractDominantColors, type ColorExtraction } from '../sampling/dominantColors';
import {
  extractDominantCmykColors,
  type CmykExtraction,
  type CmykToLabConverter,
} from '../sampling/dominantCmyk';
import type { RenderingIntent } from '../icc/colorEngine';
import {
  concatCmykPages,
  inspectPdfColorUsage,
  renderPdfPagesCmyk,
  type MuPdf,
  type PdfColorUsage,
} from './cmykPdf';
import { concatPages, renderPdfPages, type RenderOptions } from './renderPdf';

export type ColorPath = 'rgb' | 'cmyk';

export interface AnalyzePdfDeps {
  /** pdf.js e fábrica de canvas (ver `renderPdf.ts`). */
  rgb: Pick<RenderOptions, 'pdfjs' | 'createCanvas'>;
  /** Carrega o MuPDF (import dinâmico no navegador). */
  loadMupdf: () => Promise<MuPdf>;
}

export interface AnalyzePdfOptions {
  /** Perfil de saída CMYK. Obrigatório se o PDF pintar CMYK. */
  profile?: CmykToLabConverter;
  intent?: RenderingIntent;
  k?: number;
  scale?: number;
  maxPages?: number;
  maxPixelsPerPage?: number;
}

export interface PdfAnalysis {
  path: ColorPath;
  numPages: number;
  analyzedPages: number;
  /** Uso de espaços de cor, ou null se a inspeção falhou. */
  usage: PdfColorUsage | null;
  warnings: string[];
  rgb?: ColorExtraction;
  cmyk?: CmykExtraction;
}

/** O PDF pinta CMYK e nenhum perfil foi informado. */
export class CmykProfileRequiredError extends Error {
  constructor() {
    super('Este PDF usa CMYK: escolha um perfil ICC de saída para interpretar as cores.');
    this.name = 'CmykProfileRequiredError';
  }
}

export async function analyzePdf(
  file: ArrayBuffer | Uint8Array,
  deps: AnalyzePdfDeps,
  options: AnalyzePdfOptions = {},
): Promise<PdfAnalysis> {
  const { profile, intent, k = 8, scale, maxPages = 10, maxPixelsPerPage } = options;
  const warnings: string[] = [];

  let usage: PdfColorUsage | null = null;
  let mupdf: MuPdf | null = null;
  try {
    mupdf = await deps.loadMupdf();
    usage = inspectPdfColorUsage(mupdf, file, maxPages);
  } catch (e) {
    warnings.push(
      `Não foi possível inspecionar os espaços de cor (${e instanceof Error ? e.message : String(e)}); ` +
        'o arquivo foi lido como RGB e, se for CMYK, os valores são aproximados.',
    );
  }

  if (usage?.hasCmyk && mupdf) {
    if (!profile) throw new CmykProfileRequiredError();
    if (usage.hasRgb) {
      warnings.push(
        'O PDF mistura CMYK e RGB. Os elementos em RGB foram convertidos para CMYK pelo MuPDF, ' +
          'sem perfil, e suas cores são aproximadas.',
      );
    }
    if (usage.total.other > 0) {
      warnings.push('O PDF tem degradês, spot colors ou espaços de cor especiais, lidos como o MuPDF os converte.');
    }
    const rendered = renderPdfPagesCmyk(mupdf, file, { scale, maxPages, maxPixelsPerPage });
    return {
      path: 'cmyk',
      numPages: rendered.numPages,
      analyzedPages: rendered.pages.length,
      usage,
      warnings,
      cmyk: extractDominantCmykColors(concatCmykPages(rendered.pages), profile, { k, intent }),
    };
  }

  const rendered = await renderPdfPages(file, { ...deps.rgb, scale, maxPages, maxPixelsPerPage });
  return {
    path: 'rgb',
    numPages: rendered.numPages,
    analyzedPages: rendered.pages.length,
    usage,
    warnings,
    rgb: extractDominantColors(concatPages(rendered.pages), { k }),
  };
}
