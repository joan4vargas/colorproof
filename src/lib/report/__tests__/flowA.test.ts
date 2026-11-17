import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rgbToLabD50 } from '../../../core/colorimetry';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { analyzePdf, type AnalyzePdfDeps, type PdfAnalysis } from '../../pdf/analyzePdf';
import type { RenderOptions } from '../../pdf/renderPdf';
import { evaluateFlowA } from '../flowA';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
const hasProfile = existsSync(PROFILE_PATH);

const deps: AnalyzePdfDeps = {
  rgb: {
    pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
    createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
  },
  loadMupdf: () => import('mupdf'),
};

describe.skipIf(!hasProfile)('evaluateFlowA com ISO Coated v2', () => {
  let engine: ColorEngine;
  let profile: IccProfileHandle;
  let rgbAnalysis: PdfAnalysis;
  let cmykAnalysis: PdfAnalysis;

  beforeAll(async () => {
    engine = await createColorEngine();
    profile = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)));
    rgbAnalysis = await analyzePdf(fixture('cores-rgb.pdf'), deps, { scale: 1, k: 6 });
    cmykAnalysis = await analyzePdf(fixture('cores-cmyk.pdf'), deps, { scale: 1, k: 6, profile });
  });
  afterAll(() => {
    profile?.libera();
    engine?.dispose();
  });

  it('PDF em RGB: cada cor tem round-trip, e as saturadas fora do gamut reprovam', () => {
    const r = evaluateFlowA(rgbAnalysis, profile);
    expect(r.path).toBe('rgb');
    expect(r.findings).toHaveLength(6);
    expect(r.profileDescription).toBe('ISO Coated v2 (ECI)');
    expect(r.intent).toBe('relative');
    // as cores do fixture são sRGB primárias e secundárias: algumas saem do gamut do offset
    const worst = Math.max(...r.findings.map((f) => f.deltaE));
    expect(worst).toBeGreaterThan(4);
    expect(r.verdict).toBe('reprovado');
    expect(r.findings.every((f) => f.screenDeltaE === undefined)).toBe(true);
    for (const f of r.findings) {
      expect(f.source.kind).toBe('rgb');
      expect(f.cmykReproduced.c).toBeGreaterThanOrEqual(0);
      expect(f.cmykReproduced.k).toBeLessThanOrEqual(100);
    }
  });

  it('o veredito de cada cor segue as faixas 3,0 e 4,0', () => {
    const r = evaluateFlowA(rgbAnalysis, profile);
    for (const f of r.findings) {
      const expected = f.deltaE <= 3 ? 'aprovado' : f.deltaE <= 4 ? 'atencao' : 'reprovado';
      expect(f.verdict).toBe(expected);
    }
  });

  it('PDF em CMYK: cores já reprodutíveis, com ΔE de tela à parte', () => {
    const r = evaluateFlowA(cmykAnalysis, profile);
    expect(r.path).toBe('cmyk');
    expect(r.findings).toHaveLength(6);
    for (const f of r.findings) {
      expect(f.source.kind).toBe('cmyk');
      expect(f.deltaE).toBeLessThan(4.5); // piso do round-trip (L9)
      expect(f.screenDeltaE).toBeDefined();
    }
    // ciano e magenta 100% saem do sRGB: a tela mostra bem diferente do impresso
    expect(Math.max(...r.findings.map((f) => f.screenDeltaE!))).toBeGreaterThan(8);
  });

  it('o ΔE de tela não entra no veredito', () => {
    const r = evaluateFlowA(cmykAnalysis, profile);
    const byRoundTrip = r.findings.map((f) => f.verdict);
    expect(byRoundTrip.every((v) => v !== 'reprovado' || r.findings.some((f) => f.deltaE > 4))).toBe(true);
  });

  it('minPixelShare descarta cores raras e avisa quando não sobra nada', () => {
    const r = evaluateFlowA(rgbAnalysis, profile, { minPixelShare: 0.9 });
    expect(r.findings).toHaveLength(0);
    expect(r.verdict).toBe('aprovado');
    expect(r.warnings.join(' ')).toMatch(/Nenhuma cor/);
  });

  it('aceita limiares próprios', () => {
    const r = evaluateFlowA(rgbAnalysis, profile, { thresholds: { approvedMax: 100, attentionMax: 100 } });
    expect(r.verdict).toBe('aprovado');
  });

  it('cinza neutro tem round-trip quase perfeito (sanidade)', () => {
    const lab = rgbToLabD50({ r: 128, g: 128, b: 128 });
    const analysis: PdfAnalysis = {
      path: 'rgb', numPages: 1, analyzedPages: 1, usage: null, warnings: [],
      timings: { inspectMs: 0, renderMs: 0, clusterMs: 0, totalMs: 0 },
      rgb: { colors: [{ lab, rgb: { r: 128, g: 128, b: 128 }, inkShare: 1, pixelShare: 1, spread: 0 }], totalPixels: 1, paperPixels: 0, distinctColors: 1 },
    };
    const r = evaluateFlowA(analysis, profile);
    expect(r.findings[0].deltaE).toBeLessThan(1);
    expect(r.verdict).toBe('aprovado');
  });

  it('BPC ligado esconde a perda do preto (justifica o padrão desligado)', async () => {
    const withBpc = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)), 'bpc', {
      blackPointCompensation: true,
    });
    try {
      const black = rgbToLabD50({ r: 0, g: 0, b: 0 });
      const off = profile.roundTripLab(black, 'relative');
      const on = withBpc.roundTripLab(black, 'relative');
      expect(off.l).toBeGreaterThan(5); // preto impresso bem mais claro que o da tela
      expect(on.l).toBeLessThan(2); // com BPC a volta compensa e o desvio some
    } finally {
      withBpc.libera();
    }
  });
});

describe('evaluateFlowA: erros', () => {
  const profile = {
    description: 'x',
    labToCmyk: () => ({ c: 0, m: 0, y: 0, k: 0 }),
    roundTripLab: (l: { l: number; a: number; b: number }) => l,
  };
  it('análise sem os dados do caminho lança erro claro', () => {
    const base = { numPages: 1, analyzedPages: 1, usage: null, warnings: [], timings: { inspectMs: 0, renderMs: 0, clusterMs: 0, totalMs: 0 } };
    expect(() => evaluateFlowA({ ...base, path: 'rgb' }, profile)).toThrow(/RGB/);
    expect(() => evaluateFlowA({ ...base, path: 'cmyk' }, profile)).toThrow(/CMYK/);
  });
});
