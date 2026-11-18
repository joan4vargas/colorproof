import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Lab, RGB } from '../../../types/color';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { CmykProfileRequiredError } from '../../pdf/analyzePdf';
import type { RenderOptions } from '../../pdf/renderPdf';
import { compareFiles, type CompareDeps } from '../compareFiles';
import { LayoutMismatchError, comparePage, compareGrids } from '../flowB';
import { gridFromCmyk, gridFromRgba, type LabGrid } from '../labGrid';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
const hasProfile = existsSync(PROFILE_PATH);

/** Raster RGBA de `w` x `h` com blocos de cor: `paint(x, y)` devolve a cor do pixel. */
function rgba(w: number, h: number, paint: (x: number, y: number) => RGB): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      data.set([c.r, c.g, c.b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const RED: RGB = { r: 200, g: 30, b: 30 };
const GREY: RGB = { r: 128, g: 128, b: 128 };

describe('gridFromRgba', () => {
  it('guarda a cor mais frequente de cada célula, papel marcado', () => {
    // metade esquerda vermelha, direita branca; grade 2x2
    const g = gridFromRgba(rgba(40, 40, (x) => (x < 20 ? RED : WHITE)), 2);
    expect(g.cells).toHaveLength(4);
    expect(g.cells.map((c) => c.paper)).toEqual([false, true, false, true]);
    expect(g.cells.every((c) => c.share === 1)).toBe(true);
    expect(g.aspect).toBe(1);
  });

  it('célula mista: vence a cor com mais pixels e a participação mostra a mistura', () => {
    // numa célula única, 75% vermelho e 25% branco
    const g = gridFromRgba(rgba(40, 40, (x) => (x < 30 ? RED : WHITE)), 1);
    expect(g.cells[0].paper).toBe(false);
    expect(g.cells[0].share).toBeCloseTo(0.75, 6);
  });

  it('é independente da resolução (coordenadas normalizadas)', () => {
    const paint = (fx: number) => (x: number, w: number) => (x / w < fx ? RED : WHITE);
    const a = gridFromRgba(rgba(40, 40, (x) => paint(0.5)(x, 40)), 4);
    const b = gridFromRgba(rgba(200, 200, (x) => paint(0.5)(x, 200)), 4);
    expect(a.cells.map((c) => c.paper)).toEqual(b.cells.map((c) => c.paper));
  });

  it('recusa grade inválida e raster inconsistente', () => {
    expect(() => gridFromRgba(rgba(4, 4, () => RED), 0)).toThrow();
    expect(() => gridFromRgba({ width: 4, height: 4, data: new Uint8ClampedArray(10) }, 2)).toThrow(/inconsistente/);
  });
});

describe('gridFromCmyk (conversor de mentira)', () => {
  const fake = { cmyk8ToLab: (s: ArrayLike<number>): Lab[] => Array.from({ length: s.length / 4 }, (_, i) => ({ l: s[i * 4 + 3] / 2.55, a: 0, b: 0 })) };
  it('papel é 0/0/0/0; a cor passa pelo conversor', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) if (i % 4 >= 2) data.set([0, 0, 0, 255], i * 4); // metade direita: K 100%
    const g = gridFromCmyk({ width: 4, height: 4, data }, fake, 2);
    expect(g.cells.map((c) => c.paper)).toEqual([true, false, true, false]);
    expect(g.cells[1].lab.l).toBeCloseTo(100, 6);
  });
});

describe('comparePage / compareGrids', () => {
  const uniform = (rgb: RGB, grid = 4): LabGrid => gridFromRgba(rgba(40, 40, () => rgb), grid);

  it('versões idênticas: ΔE00 zero e aprovado', () => {
    const p = comparePage(1, uniform(RED), uniform(RED));
    expect(p.compared).toBe(16);
    expect(p.maxDeltaE).toBe(0);
    expect(p.verdict).toBe('aprovado');
    expect(p.shares.aprovado).toBeCloseTo(1, 9);
  });

  it('papel nas duas versões fica fora da conta', () => {
    const half = (c: RGB) => gridFromRgba(rgba(40, 40, (x) => (x < 20 ? c : WHITE)), 2);
    const p = comparePage(1, half(RED), half(RED));
    expect(p.compared).toBe(2);
  });

  it('deltaEGrid traz o ΔE00 de cada região e null onde as duas versões são papel', () => {
    const half = (c: RGB) => gridFromRgba(rgba(40, 40, (x) => (x < 20 ? c : WHITE)), 2);
    const p = comparePage(1, half(RED), half(GREY));
    expect(p.deltaEGrid).toHaveLength(4);
    expect(p.deltaEGrid[1]).toBeNull(); // coluna direita: papel nas duas
    expect(p.deltaEGrid[3]).toBeNull();
    expect(p.deltaEGrid[0]).toBeGreaterThan(20);
    expect(p.deltaEGrid[2]).toBe(p.deltaEGrid[0]);
    expect(p.deltaEGrid.filter((v) => v !== null)).toHaveLength(p.compared);
  });

  it('papel de um lado e tinta do outro é comparado (layout diferente aparece)', () => {
    const p = comparePage(1, uniform(RED), uniform(WHITE));
    expect(p.compared).toBe(16);
    expect(p.verdict).toBe('reprovado');
  });

  it('o veredito geral vem do p95; o pior caso é informado à parte', () => {
    // 1 célula de 25 muito diferente (4%): p95 continua baixo, o pior caso não
    const ref = gridFromRgba(rgba(50, 50, () => GREY), 5);
    const sim = gridFromRgba(rgba(50, 50, (x, y) => (x < 10 && y < 10 ? { r: 255, g: 0, b: 0 } : GREY)), 5);
    const p = comparePage(1, ref, sim);
    expect(p.compared).toBe(25);
    expect(p.verdict).toBe('aprovado');
    expect(p.worstCaseVerdict).toBe('reprovado');
    expect(p.worst[0]).toMatchObject({ row: 0, col: 0 });
    expect(p.worst[0].deltaE).toBeGreaterThan(20);
  });

  it('média acima de 2,5 impede o "aprovado" mesmo com p95 dentro de 3,0 (ISO 12647-7:2016)', () => {
    const grid = (l: number): LabGrid => ({ grid: 2, aspect: 1, cells: Array.from({ length: 4 }, () => ({ lab: { l, a: 0, b: 0 }, paper: false, share: 1 })) });
    // diferença uniforme de ΔL* = 2,8: ΔE00 ≈ 2,8 em toda região (p95 ≤ 3,0, média > 2,5)
    const p = comparePage(1, grid(50), grid(52.8));
    expect(p.p95DeltaE).toBeLessThanOrEqual(3);
    expect(p.meanDeltaE).toBeGreaterThan(2.5);
    expect(p.verdict).toBe('atencao');
    // ΔL* = 1: média baixa, aprovado
    expect(comparePage(1, grid(50), grid(51)).verdict).toBe('aprovado');
  });

  it('proporções diferentes: LayoutMismatchError', () => {
    const a = gridFromRgba(rgba(40, 40, () => RED), 4);
    const b = gridFromRgba(rgba(40, 60, () => RED), 4);
    expect(() => comparePage(1, a, b)).toThrow(LayoutMismatchError);
  });

  it('número de páginas diferente: compara as comuns e avisa', () => {
    const r = compareGrids([uniform(RED), uniform(RED)], [uniform(RED)]);
    expect(r.pages).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/número de páginas/);
  });

  it('tudo papel: avisa que não há o que comparar', () => {
    const r = compareGrids([uniform(WHITE)], [uniform(WHITE)]);
    expect(r.warnings.join(' ')).toMatch(/Nenhuma região/);
    expect(r.verdict).toBe('aprovado');
  });

  it('lista vazia lança erro', () => {
    expect(() => compareGrids([], [uniform(RED)])).toThrow();
  });
});

const deps: CompareDeps = {
  rgb: {
    pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
    createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
  },
  loadMupdf: () => import('mupdf'),
  rasterizeImage: async () => rgba(8, 8, () => RED),
};

describe('compareFiles (sem perfil)', () => {
  it('o mesmo PDF RGB contra ele mesmo: nenhuma diferença', async () => {
    const pdf = fixture('cores-rgb.pdf');
    const o = await compareFiles({ file: pdf, mime: 'application/pdf' }, { file: pdf.slice(), mime: 'application/pdf' }, deps);
    expect(o.report.verdict).toBe('aprovado');
    expect(o.report.pages[0].maxDeltaE).toBe(0);
    expect(o.reference.path).toBe('rgb');
  });

  it('PDF CMYK sem perfil pede o perfil', async () => {
    const pdf = fixture('cores-rgb.pdf');
    await expect(
      compareFiles({ file: pdf, mime: 'application/pdf' }, { file: fixture('cores-cmyk.pdf'), mime: 'application/pdf' }, deps),
    ).rejects.toBeInstanceOf(CmykProfileRequiredError);
  });

  it('aceita imagem nas duas pontas e informa o progresso', async () => {
    const stages: string[] = [];
    const o = await compareFiles(
      { file: new ArrayBuffer(4), mime: 'image/png' },
      { file: new ArrayBuffer(4), mime: 'image/png' },
      deps,
      { onProgress: (s) => stages.push(s) },
    );
    expect(o.report.pages).toHaveLength(1);
    expect(stages).toEqual(['reference', 'simulation', 'comparing']);
  });
});

describe.skipIf(!hasProfile)('compareFiles com ISO Coated v2', () => {
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

  it('referência RGB contra o próprio CMYK que o perfil gera: cinza reproduz bem, azul saturado não', () => {
    const paint = (x: number, w: number): RGB => (x < w / 2 ? GREY : { r: 30, g: 60, b: 200 });
    const ref = gridFromRgba(rgba(40, 40, (x) => paint(x, 40)), 2);
    // simulação: CMYK que o perfil escolhe para cada cor, em 8 bits
    const toCmyk = (c: RGB) => {
      const m = profile.rgbToDeviceCmyk(c, 'relative');
      return [m.c, m.m, m.y, m.k].map((v) => Math.round((v / 100) * 255));
    };
    const cmyk = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) };
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) cmyk.data.set(toCmyk(paint(x, 40)), (y * 40 + x) * 4);
    const sim = gridFromCmyk(cmyk, profile, 2, 'relative');
    const p = comparePage(1, ref, sim);
    const grey = p.worst.filter((w) => w.col === 0);
    const blue = p.worst.filter((w) => w.col === 1);
    expect(Math.max(...grey.map((w) => w.deltaE))).toBeLessThan(3);
    expect(Math.min(...blue.map((w) => w.deltaE))).toBeGreaterThan(4);
    expect(p.verdict).toBe('reprovado');
  });

  it('PDF RGB contra o seu par em CMYK (mesmo layout): só o azul fora do gamut reprova', async () => {
    const o = await compareFiles(
      { file: fixture('cores-rgb.pdf'), mime: 'application/pdf' },
      { file: fixture('par-simulacao-cmyk.pdf'), mime: 'application/pdf' },
      deps,
      { profile },
    );
    expect(o.reference.path).toBe('rgb');
    expect(o.simulation.path).toBe('cmyk');
    const p = o.report.pages[0];
    expect(p.compared).toBe(768); // 6 blocos de 1/8 da página: 6/8 x 1024 células
    // o azul sRGB 30/60/200 (bloco 3 da linha de cima: colunas 17 a 24) é a pior região
    expect(p.worst.every((w) => w.row < 16 && w.col >= 16 && w.col < 24)).toBe(true);
    expect(p.worst[0].deltaE).toBeGreaterThan(4);
    // os outros cinco blocos (5/6 das regiões) ficam dentro da faixa de aprovação
    expect(p.shares.aprovado).toBeGreaterThan(0.8);
    expect(p.shares.reprovado).toBeGreaterThan(0.1);
    expect(p.shares.reprovado).toBeLessThan(0.2);
    expect(p.verdict).toBe('reprovado');
  });

  it('uma versão contra ela mesma passada pelo perfil também funciona com outro intent', async () => {
    const o = await compareFiles(
      { file: fixture('cores-rgb.pdf'), mime: 'application/pdf' },
      { file: fixture('par-simulacao-cmyk.pdf'), mime: 'application/pdf' },
      deps,
      { profile, intent: 'absolute' },
    );
    expect(o.intent).toBe('absolute');
    expect(o.report.pages[0].compared).toBeGreaterThan(0);
  });
});
