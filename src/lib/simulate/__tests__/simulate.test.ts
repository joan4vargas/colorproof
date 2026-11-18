import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLabD50 } from '../../../core/colorimetry';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import type { RenderOptions } from '../../pdf/renderPdf';
import { simulatePrint, type SimulateDeps } from '../simulatePrint';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
const hasProfile = existsSync(PROFILE_PATH);

function solid(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...paint(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

// imagem de teste: metade cinza (dentro do gamut), metade azul saturado (fora)
const img = solid(60, 40, (x) => (x < 30 ? [128, 128, 128] : [0, 60, 255]));

const deps: SimulateDeps = {
  rgb: {
    pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
    createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
  },
  loadMupdf: () => import('mupdf'),
  rasterizeImage: async () => img,
};

describe.skipIf(!hasProfile)('simulação de impressão com ISO Coated v2', () => {
  let engine: ColorEngine;
  let profile: IccProfileHandle;
  beforeAll(async () => {
    engine = await createColorEngine();
    profile = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)));
  });
  afterAll(() => {
    profile?.libera();
    engine?.dispose();
  });

  it('simulateRgba mantém o tamanho e o alfa; cinza volta quase igual, azul saturado muda', () => {
    const data = new Uint8ClampedArray(img.data);
    data[3] = 77; // alfa do primeiro pixel
    const out = profile.simulateRgba(data);
    expect(out).toHaveLength(data.length);
    expect(out[3]).toBe(77);
    const lab = (a: ArrayLike<number>, o: number) => rgbToLabD50({ r: a[o], g: a[o + 1], b: a[o + 2] });
    const grey = deltaE2000(lab(data, 0), lab(out, 0));
    const blue = deltaE2000(lab(data, 59 * 4), lab(out, 59 * 4));
    expect(grey).toBeLessThan(3);
    expect(blue).toBeGreaterThan(8);
  });

  it('simulateRgba atravessa vários lotes (mais de 32768 pixels) sem trocar a ordem', () => {
    const big = solid(300, 200, (x) => (x < 150 ? [128, 128, 128] : [200, 30, 30]));
    const out = profile.simulateRgba(big.data);
    expect(out).toHaveLength(big.data.length);
    expect(out[0]).toBeCloseTo(out[(199 * 300 + 10) * 4], -1); // mesma cor no começo e no fim da coluna
    expect(out[(100 * 300 + 200) * 4]).toBeGreaterThan(out[(100 * 300 + 200) * 4 + 2]); // vermelho continua vermelho
  });

  it('cmyk8ToRgba: papel (0/0/0/0) vira branco e 100% de preto fica bem escuro', () => {
    const out = profile.cmyk8ToRgba(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255]));
    expect([...out.slice(0, 3)].every((v) => v >= 250)).toBe(true);
    expect(out[3]).toBe(255);
    expect(Math.max(...out.slice(4, 7))).toBeLessThan(60);
  });

  it('imagem: devolve original, simulada e comparação por região; só o azul reprova', async () => {
    const sim = await simulatePrint({ file: new ArrayBuffer(8), mime: 'image/png' }, deps, { profile });
    expect(sim.path).toBe('rgb');
    expect(sim.original).not.toBeNull();
    expect(sim.simulated).toHaveLength(60 * 40 * 4);
    const page = sim.report!.pages[0];
    expect(page.deltaEGrid).toHaveLength(32 * 32);
    const half = (col0: number, col1: number) => {
      const v: number[] = [];
      for (let r = 0; r < 32; r++) for (let c = col0; c < col1; c++) v.push(page.deltaEGrid[r * 32 + c] ?? 0);
      return Math.max(...v);
    };
    expect(half(0, 15)).toBeLessThan(3);
    expect(half(17, 32)).toBeGreaterThan(4);
  });

  it('PDF em RGB: lê a primeira página pelo pdf.js e compara', async () => {
    const sim = await simulatePrint({ file: fixture('cores-rgb.pdf'), mime: 'application/pdf' }, deps, { profile });
    expect(sim.path).toBe('rgb');
    expect(sim.report?.pages).toHaveLength(1);
    expect(sim.width).toBeGreaterThan(100);
  });

  it('PDF em CMYK: mostra só a simulação, sem comparação, e avisa', async () => {
    const sim = await simulatePrint({ file: fixture('par-simulacao-cmyk.pdf'), mime: 'application/pdf' }, deps, { profile });
    expect(sim.path).toBe('cmyk');
    expect(sim.original).toBeNull();
    expect(sim.report).toBeNull();
    expect(sim.simulated.length).toBe(sim.width * sim.height * 4);
    expect(sim.warnings.join(' ')).toMatch(/já está em CMYK/);
  });
});
