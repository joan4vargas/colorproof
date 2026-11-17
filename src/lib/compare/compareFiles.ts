// Fluxo B de ponta a ponta: duas entradas (PDF ou imagem) -> grades de cor -> laudo.
//
// Cada entrada é lida pelo caminho certo, como no Fluxo A (docs, seção 8):
// PDF sem CMYK pelo pdf.js (sRGB); PDF com CMYK pelo MuPDF, com o perfil ICC
// escolhido; imagens pelo navegador (sRGB).
//
// Intent: o Fluxo B compara uma referência de tela com a versão para impressão,
// então o padrão é o RELATIVO (o branco do papel conta como branco). Com o
// absoluto, toda região de papel apareceria com ΔE00 por causa da cor do
// papel. A decisão D1 (docs, 8c) previu o absoluto para comparar CMYK contra
// os valores de caracterização do perfil, que é outro uso; ver docs 8e.

import type { RenderingIntent } from '../icc/colorEngine';
import {
  CmykProfileRequiredError,
  type AnalyzePdfDeps,
} from '../pdf/analyzePdf';
import { inspectPdfColorUsage, renderPdfPagesCmyk, type MuPdf } from '../pdf/cmykPdf';
import { renderPdfPages } from '../pdf/renderPdf';
import { compareGrids, type FlowBOptions, type FlowBReport } from './flowB';
import { DEFAULT_GRID, gridFromCmyk, gridFromRgba, type CmykLabConverter, type LabGrid } from './labGrid';

export type ComparePath = 'rgb' | 'cmyk';

export interface CompareInput {
  file: ArrayBuffer | Uint8Array;
  /** Tipo MIME; `application/pdf` ou uma imagem. */
  mime: string;
}

export interface CompareDeps extends AnalyzePdfDeps {
  rasterizeImage: (
    bytes: ArrayBuffer,
    mime: string,
    maxPixels?: number,
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

export interface CompareOptions extends FlowBOptions {
  profile?: CmykLabConverter;
  intent?: RenderingIntent;
  grid?: number;
  scale?: number;
  maxPages?: number;
  maxPixelsPerPage?: number;
  /** Chamada ao começar cada etapa. */
  onProgress?: (stage: CompareStage) => void;
}

export type CompareStage = 'reference' | 'simulation' | 'comparing';

export interface CompareSide {
  path: ComparePath;
  numPages: number;
  pages: number;
}

export interface CompareOutcome {
  report: FlowBReport;
  reference: CompareSide;
  simulation: CompareSide;
  intent: RenderingIntent;
  totalMs: number;
}

const isPdf = (mime: string) => mime === 'application/pdf';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function readGrids(
  input: CompareInput,
  deps: CompareDeps,
  options: CompareOptions,
  warnings: string[],
  label: string,
): Promise<{ grids: LabGrid[]; side: CompareSide }> {
  const { profile, intent = 'relative', grid = DEFAULT_GRID, scale = 1, maxPages = 10, maxPixelsPerPage } = options;

  if (!isPdf(input.mime)) {
    const bytes =
      input.file instanceof Uint8Array
        ? (input.file.buffer.slice(input.file.byteOffset, input.file.byteOffset + input.file.byteLength) as ArrayBuffer)
        : input.file;
    const img = await deps.rasterizeImage(bytes, input.mime, maxPixelsPerPage);
    return {
      grids: [gridFromRgba(img, grid)],
      side: { path: 'rgb', numPages: 1, pages: 1 },
    };
  }

  let mupdf: MuPdf | null = null;
  let hasCmyk = false;
  try {
    mupdf = await deps.loadMupdf();
    const usage = inspectPdfColorUsage(mupdf, input.file, maxPages);
    hasCmyk = usage.hasCmyk;
    if (usage.hasCmyk && usage.hasRgb) {
      warnings.push(`${label}: o PDF mistura CMYK e RGB; os elementos RGB foram convertidos para CMYK pelo MuPDF, sem perfil.`);
    }
  } catch (e) {
    warnings.push(
      `${label}: não foi possível inspecionar os espaços de cor (${e instanceof Error ? e.message : String(e)}); o arquivo foi lido como RGB.`,
    );
  }

  if (hasCmyk && mupdf) {
    if (!profile) throw new CmykProfileRequiredError();
    const rendered = renderPdfPagesCmyk(mupdf, input.file, { scale, maxPages, maxPixelsPerPage });
    return {
      grids: rendered.pages.map((p) => gridFromCmyk(p, profile, grid, intent)),
      side: { path: 'cmyk', numPages: rendered.numPages, pages: rendered.pages.length },
    };
  }
  const rendered = await renderPdfPages(input.file, { ...deps.rgb, scale, maxPages, maxPixelsPerPage });
  return {
    grids: rendered.pages.map((p) => gridFromRgba(p, grid)),
    side: { path: 'rgb', numPages: rendered.numPages, pages: rendered.pages.length },
  };
}

export async function compareFiles(
  reference: CompareInput,
  simulation: CompareInput,
  deps: CompareDeps,
  options: CompareOptions = {},
): Promise<CompareOutcome> {
  const t0 = now();
  const warnings: string[] = [];
  options.onProgress?.('reference');
  const ref = await readGrids(reference, deps, options, warnings, 'Referência');
  options.onProgress?.('simulation');
  const sim = await readGrids(simulation, deps, options, warnings, 'Simulação');
  options.onProgress?.('comparing');
  const report = compareGrids(ref.grids, sim.grids, options);
  report.warnings.unshift(...warnings);
  return {
    report,
    reference: ref.side,
    simulation: sim.side,
    intent: options.intent ?? 'relative',
    totalMs: now() - t0,
  };
}
