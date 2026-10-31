import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLabD50 } from '../../../core/colorimetry';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { analyzePdf, CmykProfileRequiredError, type AnalyzePdfDeps } from '../analyzePdf';
import type { RenderOptions } from '../renderPdf';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const load = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

const deps: AnalyzePdfDeps = {
  rgb: {
    pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
    createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
  },
  loadMupdf: () => import('mupdf'),
};

describe('analyzePdf: caminho RGB', () => {
  it('PDF só em RGB usa o pdf.js e devolve as cores exatas', async () => {
    const a = await analyzePdf(load('cores-rgb.pdf'), deps, { k: 6, scale: 1 });
    expect(a.path).toBe('rgb');
    expect(a.cmyk).toBeUndefined();
    expect(a.warnings).toEqual([]);
    expect(a.rgb!.colors).toHaveLength(6);
    expect(a.rgb!.colors.every((c) => Math.abs(c.pixelShare - 0.125) < 1e-9)).toBe(true);
    expect(a.usage!.hasRgb).toBe(true);
  });

  it('não exige perfil quando o PDF não tem CMYK', async () => {
    await expect(analyzePdf(load('cores-rgb.pdf'), deps, { scale: 1 })).resolves.toBeDefined();
  });

  it('se o MuPDF não carregar, cai para RGB e avisa', async () => {
    const broken: AnalyzePdfDeps = { ...deps, loadMupdf: () => Promise.reject(new Error('sem wasm')) };
    const a = await analyzePdf(load('cores-cmyk.pdf'), broken, { scale: 1 });
    expect(a.path).toBe('rgb');
    expect(a.usage).toBeNull();
    expect(a.warnings[0]).toMatch(/sem wasm/);
  });
});

describe('analyzePdf: caminho CMYK exige perfil', () => {
  it('PDF com CMYK e sem perfil lança CmykProfileRequiredError', async () => {
    await expect(analyzePdf(load('cores-cmyk.pdf'), deps, { scale: 1 })).rejects.toBeInstanceOf(
      CmykProfileRequiredError,
    );
  });
});

for (const file of ['ISOcoated_v2_eci.icc', 'PSOcoated_v3.icc']) {
  const path = resolve(process.cwd(), 'public/profiles', file);
  describe.skipIf(!existsSync(path))(`analyzePdf: caminho CMYK com ${file}`, () => {
    let engine: ColorEngine;
    let profile: IccProfileHandle;
    beforeAll(async () => {
      engine = await createColorEngine();
      profile = await engine.loadProfile(new Uint8Array(readFileSync(path)), file);
    });
    afterAll(() => {
      profile?.libera();
      engine?.dispose();
    });

    const CMYK = [
      { c: 100, m: 0, y: 0, k: 0 },
      { c: 0, m: 100, y: 0, k: 0 },
      { c: 0, m: 0, y: 100, k: 0 },
      { c: 0, m: 0, y: 0, k: 100 },
      { c: 40, m: 70, y: 0, k: 10 },
      { c: 0, m: 50, y: 100, k: 0 },
    ];

    it('devolve as seis cores CMYK do arquivo, com o Lab do perfil e 12,5% cada', async () => {
      const a = await analyzePdf(load('cores-cmyk.pdf'), deps, { profile, k: 6, scale: 1, intent: 'absolute' });
      expect(a.path).toBe('cmyk');
      expect(a.rgb).toBeUndefined();
      expect(a.warnings).toEqual([]);
      expect(a.cmyk!.colors).toHaveLength(6);
      expect(a.cmyk!.paperPixels).toBe(5000);
      for (const expected of CMYK) {
        // 8 bits: o valor lido é o do arquivo arredondado a 1/255 (até ~0,2 pontos percentuais)
        const found = a.cmyk!.colors.find(
          (c) =>
            Math.abs(c.cmyk.c - expected.c) < 0.3 &&
            Math.abs(c.cmyk.m - expected.m) < 0.3 &&
            Math.abs(c.cmyk.y - expected.y) < 0.3 &&
            Math.abs(c.cmyk.k - expected.k) < 0.3,
        );
        expect(found, `CMYK ${JSON.stringify(expected)} não encontrado`).toBeDefined();
        expect(found!.pixelShare).toBeCloseTo(0.125, 9);
        expect(found!.spread).toBeLessThan(1e-9);
        // O pixmap tem 8 bits: 70% vira 178/255 (69,8%). Esse arredondamento é a única
        // diferença contra o valor do arquivo e custa até ~0,2 ΔE00.
        expect(deltaE2000(found!.lab, profile.cmykToLab(expected, 'absolute'))).toBeLessThan(0.25);
      }
    });

    it('é muito mais fiel ao perfil do que a rasterização do pdf.js (ΔE00 < 0,25 contra 3,7 a 10,9)', async () => {
      // O mesmo arquivo pelos dois caminhos: o do pdf.js (sRGB) e o do MuPDF (CMYK).
      const viaCmyk = await analyzePdf(load('cores-cmyk.pdf'), deps, { profile, k: 6, scale: 1, intent: 'relative' });
      const brokenMupdf: AnalyzePdfDeps = { ...deps, loadMupdf: () => Promise.reject(new Error('x')) };
      const viaPdfjs = await analyzePdf(load('cores-cmyk.pdf'), brokenMupdf, { k: 6, scale: 1 });
      const err = (labs: Array<{ l: number; a: number; b: number }>) =>
        CMYK.map((cmyk) => {
          const ref = profile.cmykToLab(cmyk, 'relative');
          return Math.min(...labs.map((l) => deltaE2000(l, ref)));
        });
      const eCmyk = err(viaCmyk.cmyk!.colors.map((c) => c.lab));
      const ePdfjs = err(viaPdfjs.rgb!.colors.map((c) => rgbToLabD50(c.rgb)));
      expect(Math.max(...eCmyk)).toBeLessThan(0.25);
      expect(Math.max(...ePdfjs)).toBeGreaterThan(3);
    });

    it('PDF misto: usa o caminho CMYK e avisa', async () => {
      const a = await analyzePdf(load('misto.pdf'), deps, { profile, k: 4, scale: 1 });
      expect(a.path).toBe('cmyk');
      expect(a.warnings.some((w) => /mistura CMYK e RGB/.test(w))).toBe(true);
    });

    it('imagem CMYK (JPEG): cores lidas e proporções', async () => {
      const a = await analyzePdf(load('imagem-cmyk-jpeg.pdf'), deps, { profile, k: 2, scale: 1 });
      expect(a.path).toBe('cmyk');
      // A imagem tem 100 x 50 pt (5000 px de 20000): duas cores de 12,5% e 75% de papel.
      expect(a.cmyk!.paperPixels).toBe(15000);
      expect(a.cmyk!.colors.map((c) => c.pixelShare.toFixed(3))).toEqual(['0.125', '0.125']);
    });
  });
}
