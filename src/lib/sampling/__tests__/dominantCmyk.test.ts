import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deltaE2000 } from '../../../core/colorimetry';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { extractDominantCmykColors, type CmykToLabConverter } from '../dominantCmyk';

/** Conversor falso: Lab depende só do K e do C, o suficiente para testar a estatística. */
const fake: CmykToLabConverter = {
  cmyk8ToLab(samples) {
    const out = [];
    for (let i = 0; i < samples.length; i += 4) {
      out.push({ l: 100 - samples[i + 3] / 2.55, a: -samples[i] / 4, b: samples[i + 1] / 4 });
    }
    return out;
  },
};

/** Monta pixels CMYK a partir de blocos [CMYK 0-255, quantidade]. */
function pixels(blocks: Array<[[number, number, number, number], number]>): Uint8ClampedArray {
  const total = blocks.reduce((s, [, n]) => s + n, 0);
  const data = new Uint8ClampedArray(total * 4);
  let p = 0;
  for (const [cmyk, n] of blocks) {
    for (let i = 0; i < n; i++, p += 4) data.set(cmyk, p);
  }
  return data;
}

const PAPER: [number, number, number, number] = [0, 0, 0, 0];
const CYAN: [number, number, number, number] = [255, 0, 0, 0];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe('extractDominantCmykColors (conversor falso)', () => {
  it('descarta o papel (0/0/0/0) e calcula as frações', () => {
    const r = extractDominantCmykColors(pixels([[PAPER, 50], [CYAN, 30], [BLACK, 20]]), fake, { k: 4 });
    expect(r.totalPixels).toBe(100);
    expect(r.paperPixels).toBe(50);
    expect(r.distinctColors).toBe(2);
    expect(r.colors).toHaveLength(2);
    expect(r.colors[0].cmyk).toEqual({ c: 100, m: 0, y: 0, k: 0 });
    expect(r.colors[0].inkShare).toBeCloseTo(0.6, 10);
    expect(r.colors[0].pixelShare).toBeCloseTo(0.3, 10);
    expect(r.colors[1].cmyk).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('um tom claro (1% de ciano) continua sendo tinta', () => {
    const r = extractDominantCmykColors(pixels([[PAPER, 10], [[3, 0, 0, 0], 10]]), fake, { k: 2 });
    expect(r.paperPixels).toBe(10);
    expect(r.colors).toHaveLength(1);
    expect(r.colors[0].cmyk.c).toBeCloseTo((3 / 255) * 100, 10);
  });

  it('com excludePaper = false o papel conta como cor', () => {
    const r = extractDominantCmykColors(pixels([[PAPER, 10], [CYAN, 10]]), fake, { k: 2, excludePaper: false });
    expect(r.paperPixels).toBe(0);
    expect(r.colors).toHaveLength(2);
  });

  it('só papel devolve lista vazia; tamanho inválido lança erro; é determinístico', () => {
    expect(extractDominantCmykColors(pixels([[PAPER, 9]]), fake).colors).toEqual([]);
    expect(() => extractDominantCmykColors(new Uint8ClampedArray(6), fake)).toThrow(/múltiplo de 4/);
    const img = pixels([[CYAN, 40], [BLACK, 35], [[0, 255, 0, 0], 25]]);
    expect(extractDominantCmykColors(img, fake, { k: 3 })).toEqual(extractDominantCmykColors(img, fake, { k: 3 }));
  });

  it('chaves de 32 bits: valores altos de C não viram negativos', () => {
    const r = extractDominantCmykColors(pixels([[[255, 255, 255, 255], 5]]), fake, { k: 1 });
    expect(r.colors[0].cmyk).toEqual({ c: 100, m: 100, y: 100, k: 100 });
  });
});

for (const file of ['ISOcoated_v2_eci.icc', 'PSOcoated_v3.icc']) {
  const path = resolve(process.cwd(), 'public/profiles', file);
  describe.skipIf(!existsSync(path))(`com o perfil ${file}`, () => {
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

    it('cmyk8ToLab em lote equivale a cmykToLab cor a cor (ΔE00 < 0,01)', () => {
      const colors: Array<[number, number, number, number]> = [
        [0, 0, 0, 0],
        [255, 0, 0, 0],
        [0, 255, 0, 0],
        [0, 0, 255, 0],
        [0, 0, 0, 255],
        [102, 178, 0, 25],
        [51, 51, 51, 51],
        [200, 30, 90, 10],
      ];
      for (const intent of ['relative', 'absolute'] as const) {
        const batch = profile.cmyk8ToLab(colors.flat(), intent);
        colors.forEach((c, i) => {
          const single = profile.cmykToLab(
            { c: (c[0] / 255) * 100, m: (c[1] / 255) * 100, y: (c[2] / 255) * 100, k: (c[3] / 255) * 100 },
            intent,
          );
          expect(deltaE2000(batch[i], single), `${c} (${intent})`).toBeLessThan(0.01);
        });
      }
    });

    it('cmyk8ToLab converte mais de um bloco (mais de 32768 cores) sem erro de borda', () => {
      const n = 70000;
      const data = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) data.set([i % 256, (i >> 4) % 256, (i >> 8) % 256, 0], i * 4);
      const labs = profile.cmyk8ToLab(data);
      expect(labs).toHaveLength(n);
      const last = n - 1;
      const single = profile.cmykToLab({
        c: (data[last * 4] / 255) * 100,
        m: (data[last * 4 + 1] / 255) * 100,
        y: (data[last * 4 + 2] / 255) * 100,
        k: 0,
      });
      expect(deltaE2000(labs[last], single)).toBeLessThan(0.01);
    });

    it('o ciano 100% lido do pixmap dá o Lab do sólido do perfil', () => {
      const r = extractDominantCmykColors(pixels([[CYAN, 10]]), profile, { k: 1, intent: 'absolute' });
      const ref = profile.cmykToLab({ c: 100, m: 0, y: 0, k: 0 }, 'absolute');
      expect(deltaE2000(r.colors[0].lab, ref)).toBeLessThan(0.01);
    });
  });
}
