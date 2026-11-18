// Simulação de impressão a partir de UM arquivo.
//
// A pessoa envia o arquivo; o programa gera a versão "como sairia impressa":
//  - imagem ou PDF em RGB: cada pixel vai de sRGB para CMYK (B2A do perfil) e
//    volta para sRGB de tela (A2B). A diferença entre as duas imagens é o que
//    a condição de impressão não consegue reproduzir (gamut);
//  - PDF com CMYK: os valores C, M, Y, K do arquivo (lidos pelo MuPDF, sem
//    ICC) são mostrados pelo perfil. Não há versão RGB de referência, então
//    não há comparação, só a imagem simulada.
//
// A comparação reaproveita o Fluxo B (`labGrid` + `flowB`): a grade 32x32 do
// original contra a da simulação, ΔE00 por região, veredito pelo p95.
// Só a primeira página entra na simulação (as demais ficam para a análise).

import type { RenderingIntent, IccProfileHandle } from '../icc/colorEngine';
import { compareGrids, type FlowBOptions, type FlowBReport } from '../compare/flowB';
import { DEFAULT_GRID, gridFromRgba } from '../compare/labGrid';
import type { AnalyzePdfDeps } from '../pdf/analyzePdf';
import { inspectPdfColorUsage, renderPdfPagesCmyk, type MuPdf } from '../pdf/cmykPdf';
import { renderPdfPages } from '../pdf/renderPdf';

export type SimulationProfile = Pick<IccProfileHandle, 'simulateRgba' | 'cmyk8ToRgba' | 'description'>;

export interface SimulateDeps extends AnalyzePdfDeps {
  rasterizeImage: (
    bytes: ArrayBuffer,
    mime: string,
    maxPixels?: number,
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

export interface SimulateOptions extends FlowBOptions {
  profile: SimulationProfile;
  intent?: RenderingIntent;
  grid?: number;
  scale?: number;
  /** Página a simular, contando de 1 (padrão 1). */
  page?: number;
  /** Tamanho máximo da imagem de visualização, em pixels (padrão 1,5 milhão). */
  maxPixels?: number;
  onProgress?: (stage: SimulateStage) => void;
}

export type SimulateStage = 'reading' | 'simulating' | 'comparing';

export interface PrintSimulation {
  path: 'rgb' | 'cmyk';
  width: number;
  height: number;
  /** RGBA do arquivo como a tela o mostra; null quando o PDF já é CMYK. */
  original: Uint8ClampedArray | null;
  /** RGBA de como a condição de impressão reproduz o arquivo. */
  simulated: Uint8ClampedArray;
  /** Comparação por região (grade x grade); null quando não há original RGB. */
  report: FlowBReport | null;
  numPages: number;
  /** Página mostrada, contando de 1. */
  page: number;
  intent: RenderingIntent;
  warnings: string[];
  totalMs: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function simulatePrint(
  input: { file: ArrayBuffer | Uint8Array; mime: string },
  deps: SimulateDeps,
  options: SimulateOptions,
): Promise<PrintSimulation> {
  const t0 = now();
  const { profile, intent = 'relative', grid = DEFAULT_GRID, scale = 1.5, maxPixels = 1_500_000, page: wantedPage = 1 } = options;
  const warnings: string[] = [];
  options.onProgress?.('reading');

  let width: number;
  let height: number;
  let original: Uint8ClampedArray | null = null;
  let cmykData: Uint8ClampedArray | null = null;
  let numPages = 1;
  let shownPage = 1;

  if (input.mime !== 'application/pdf') {
    const bytes =
      input.file instanceof Uint8Array
        ? (input.file.buffer.slice(input.file.byteOffset, input.file.byteOffset + input.file.byteLength) as ArrayBuffer)
        : input.file;
    const img = await deps.rasterizeImage(bytes, input.mime, maxPixels);
    ({ width, height } = img);
    original = img.data;
  } else {
    let mupdf: MuPdf | null = null;
    let hasCmyk = false;
    try {
      mupdf = await deps.loadMupdf();
      hasCmyk = inspectPdfColorUsage(mupdf, input.file, 30).hasCmyk;
    } catch (e) {
      warnings.push(
        `Não foi possível inspecionar os espaços de cor (${e instanceof Error ? e.message : String(e)}); o arquivo foi lido como RGB.`,
      );
    }
    if (hasCmyk && mupdf) {
      const r = renderPdfPagesCmyk(mupdf, input.file, { scale, maxPages: 1, firstPage: wantedPage, maxPixelsPerPage: maxPixels });
      numPages = r.numPages;
      shownPage = r.pages[0].pageNumber;
      ({ width, height } = r.pages[0]);
      cmykData = r.pages[0].data;
    } else {
      const r = await renderPdfPages(input.file, { ...deps.rgb, scale, maxPages: 1, firstPage: wantedPage, maxPixelsPerPage: maxPixels });
      numPages = r.numPages;
      shownPage = r.pages[0].pageNumber;
      ({ width, height } = r.pages[0]);
      original = r.pages[0].data;
    }
  }
  options.onProgress?.('simulating');
  const simulated = cmykData ? profile.cmyk8ToRgba(cmykData, intent) : profile.simulateRgba(original!, intent);

  let report: FlowBReport | null = null;
  if (original) {
    options.onProgress?.('comparing');
    // Os dois lados passam pelo mesmo caminho (sRGB -> Lab), então a diferença vem só do perfil.
    report = compareGrids(
      [gridFromRgba({ width, height, data: original }, grid)],
      [gridFromRgba({ width, height, data: simulated }, grid)],
      options,
    );
    for (const p of report.pages) p.pageNumber = shownPage;
  } else {
    warnings.push('O PDF já está em CMYK: a imagem mostra como o perfil reproduz esses valores. Não há versão RGB para comparar.');
  }

  return {
    path: cmykData ? 'cmyk' : 'rgb',
    width,
    height,
    original,
    simulated,
    report,
    numPages,
    page: shownPage,
    intent,
    warnings,
    totalMs: now() - t0,
  };
}
