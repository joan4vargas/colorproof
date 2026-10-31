import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLabD50 } from '../../../core/colorimetry';
import { createColorEngine, type ColorEngine } from '../../icc/colorEngine';
import { extractDominantColors } from '../../sampling/dominantColors';
import { concatPages, renderPdfPages, type RenderOptions } from '../renderPdf';

// Os PDFs de teste vêm de scripts/gerar-fixtures-pdf.py: página de 200 x 100 pt
// com seis retângulos de 50 x 50 pt (2500 px cada em escala 1, ou seja 12,5% da
// página cada) e duas posições vazias (25% de papel).
const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const load = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

const lib: Pick<RenderOptions, 'pdfjs' | 'createCanvas'> = {
  pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
  createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
};

describe('renderPdfPages (pdf.js + canvas em Node)', () => {
  it('rasteriza a página com o tamanho esperado na escala pedida', async () => {
    const r1 = await renderPdfPages(load('cores-rgb.pdf'), { ...lib, scale: 1 });
    expect(r1.numPages).toBe(1);
    expect([r1.pages[0].width, r1.pages[0].height]).toEqual([200, 100]);
    expect(r1.pages[0].data).toHaveLength(200 * 100 * 4);

    const r2 = await renderPdfPages(load('cores-rgb.pdf'), { ...lib, scale: 2 });
    expect([r2.pages[0].width, r2.pages[0].height]).toEqual([400, 200]);
  });

  it('reduz a escala quando a página passa do limite de pixels', async () => {
    const r = await renderPdfPages(load('cores-rgb.pdf'), {
      ...lib,
      scale: 10,
      maxPixelsPerPage: 20000, // 200 x 100 = 20000: equivale à escala 1
    });
    expect(r.pages[0].width * r.pages[0].height).toBeLessThanOrEqual(20000);
    expect(r.pages[0].width).toBeGreaterThanOrEqual(195);
  });

  it('não invalida o buffer de quem chama', async () => {
    const buf = load('cores-rgb.pdf');
    const before = buf.length;
    await renderPdfPages(buf, { ...lib, scale: 1 });
    expect(buf.length).toBe(before);
    // e dá para renderizar de novo com o mesmo buffer
    await renderPdfPages(buf, { ...lib, scale: 1 });
  });

  it('o fundo é papel branco opaco', async () => {
    const r = await renderPdfPages(load('cores-rgb.pdf'), { ...lib, scale: 1 });
    const d = r.pages[0].data;
    const o = (80 * 200 + 175) * 4; // posição vazia (canto inferior direito)
    expect([d[o], d[o + 1], d[o + 2], d[o + 3]]).toEqual([255, 255, 255, 255]);
  });

  it('concatPages junta os pixels de todas as páginas', () => {
    const page = (n: number) => ({ pageNumber: n, width: 1, height: 1, data: new Uint8ClampedArray([n, n, n, 255]) });
    expect(Array.from(concatPages([page(1), page(2)]))).toEqual([1, 1, 1, 255, 2, 2, 2, 255]);
  });
});

describe('PDF em RGB: cores dominantes', () => {
  const EXPECTED = [
    { r: 200, g: 30, b: 30 },
    { r: 30, g: 150, b: 60 },
    { r: 30, g: 60, b: 200 },
    { r: 255, g: 128, b: 0 },
    { r: 128, g: 128, b: 128 },
    { r: 139, g: 69, b: 19 },
  ];

  it('encontra as seis cores, cada uma com 12,5% da página', async () => {
    const { pages } = await renderPdfPages(load('cores-rgb.pdf'), { ...lib, scale: 1 });
    const e = extractDominantColors(concatPages(pages), { k: 6 });
    expect(e.totalPixels).toBe(20000);
    expect(e.paperPixels).toBe(5000);
    expect(e.colors).toHaveLength(6);
    for (const expected of EXPECTED) {
      const found = e.colors.find((c) => deltaE2000(c.lab, rgbToLabD50(expected)) < 0.5);
      expect(found, `cor ${JSON.stringify(expected)} não encontrada`).toBeDefined();
      expect(found!.pixelShare).toBeCloseTo(0.125, 6);
      expect(found!.rgb).toEqual(expected);
    }
  });

  it('a escala não muda as cores nem as proporções (retângulos alinhados à grade)', async () => {
    const { pages } = await renderPdfPages(load('cores-rgb.pdf'), { ...lib, scale: 2 });
    const e = extractDominantColors(concatPages(pages), { k: 6 });
    expect(e.colors.map((c) => c.pixelShare.toFixed(3))).toEqual(Array(6).fill('0.125'));
  });
});

// ---------------------------------------------------------------------------
// PDF em CMYK: a conversão do pdf.js para sRGB e o seu desvio contra o perfil
// ---------------------------------------------------------------------------

const CMYK_PATCHES = [
  { c: 100, m: 0, y: 0, k: 0, at: [25, 25] },
  { c: 0, m: 100, y: 0, k: 0, at: [75, 25] },
  { c: 0, m: 0, y: 100, k: 0, at: [125, 25] },
  { c: 0, m: 0, y: 0, k: 100, at: [175, 25] },
  { c: 40, m: 70, y: 0, k: 10, at: [25, 75] },
  { c: 0, m: 50, y: 100, k: 0, at: [75, 75] },
] as const;

describe('PDF em CMYK: o que o pdf.js entrega', () => {
  let engine: ColorEngine;
  beforeAll(async () => {
    engine = await createColorEngine();
  });
  afterAll(() => engine?.dispose());

  it('o pdf.js entrega sRGB: cada cor CMYK chega como um valor RGB único e sólido', async () => {
    const { pages } = await renderPdfPages(load('cores-cmyk.pdf'), { ...lib, scale: 1 });
    const e = extractDominantColors(concatPages(pages), { k: 6 });
    expect(e.colors).toHaveLength(6);
    expect(e.colors.every((c) => c.spread < 1e-9)).toBe(true);
  });

  for (const file of ['ISOcoated_v2_eci.icc', 'PSOcoated_v3.icc']) {
    const path = resolve(process.cwd(), 'public/profiles', file);
    it.skipIf(!existsSync(path))(
      `${file}: a conversão CMYK→sRGB do pdf.js difere do perfil por mais de ΔE00 5 em alguma cor`,
      async () => {
        // Documenta a limitação L13: rasterizar com o pdf.js NÃO preserva o CMYK
        // do arquivo. Os limites são guarda contra regressão sobre o que foi
        // observado (máximo de ~11 ΔE00 no ciano 100%), não tolerâncias de norma.
        const profile = await engine.loadProfile(new Uint8Array(readFileSync(path)), file);
        const { pages } = await renderPdfPages(load('cores-cmyk.pdf'), { ...lib, scale: 1 });
        const d = pages[0].data;
        const diffs = CMYK_PATCHES.map((p) => {
          const o = (p.at[1] * 200 + p.at[0]) * 4;
          const lab = rgbToLabD50({ r: d[o], g: d[o + 1], b: d[o + 2] });
          return deltaE2000(lab, profile.cmykToLab(p, 'relative'));
        });
        profile.libera();
        expect(Math.max(...diffs)).toBeGreaterThan(5);
        expect(Math.max(...diffs)).toBeLessThan(20);
      },
    );
  }
});
