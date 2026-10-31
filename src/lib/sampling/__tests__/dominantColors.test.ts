import { describe, expect, it } from 'vitest';
import { extractDominantColors } from '../dominantColors';
import { deltaE2000, rgbToLabD50 } from '../../../core/colorimetry';
import type { RGB } from '../../../types/color';

/** Monta um buffer RGBA a partir de blocos [cor, quantidade de pixels]. */
function image(blocks: Array<[RGB | null, number]>, alpha = 255): Uint8ClampedArray {
  const total = blocks.reduce((s, [, n]) => s + n, 0);
  const data = new Uint8ClampedArray(total * 4);
  let p = 0;
  for (const [rgb, n] of blocks) {
    for (let i = 0; i < n; i++, p += 4) {
      const c = rgb ?? { r: 255, g: 255, b: 255 };
      data[p] = c.r;
      data[p + 1] = c.g;
      data[p + 2] = c.b;
      data[p + 3] = alpha;
    }
  }
  return data;
}

const RED: RGB = { r: 200, g: 30, b: 30 };
const BLUE: RGB = { r: 30, g: 60, b: 200 };

describe('extractDominantColors', () => {
  it('descarta o papel e calcula as frações de tinta e de pixels', () => {
    const r = extractDominantColors(image([[null, 50], [RED, 30], [BLUE, 20]]), { k: 4 });
    expect(r.totalPixels).toBe(100);
    expect(r.paperPixels).toBe(50);
    expect(r.distinctColors).toBe(2);
    expect(r.colors).toHaveLength(2);
    expect(r.colors[0].rgb).toEqual(RED);
    expect(r.colors[0].inkShare).toBeCloseTo(0.6, 10);
    expect(r.colors[0].pixelShare).toBeCloseTo(0.3, 10);
    expect(r.colors[1].rgb).toEqual(BLUE);
    expect(r.colors[1].pixelShare).toBeCloseTo(0.2, 10);
  });

  it('o centróide de uma cor sólida é exatamente o Lab dela', () => {
    const r = extractDominantColors(image([[RED, 10]]), { k: 1 });
    expect(deltaE2000(r.colors[0].lab, rgbToLabD50(RED))).toBeLessThan(1e-9);
    expect(r.colors[0].spread).toBeLessThan(1e-9);
  });

  it('com excludePaper = false o branco vira uma cor como as outras', () => {
    const r = extractDominantColors(image([[null, 50], [RED, 50]]), { k: 2, excludePaper: false });
    expect(r.paperPixels).toBe(0);
    expect(r.colors).toHaveLength(2);
  });

  it('um tom muito claro (não branco) continua sendo tinta', () => {
    const light: RGB = { r: 235, g: 235, b: 235 }; // L* ~ 93
    const r = extractDominantColors(image([[null, 10], [light, 10]]), { k: 2 });
    expect(r.paperPixels).toBe(10);
    expect(r.colors).toHaveLength(1);
  });

  it('pixels transparentes são ignorados', () => {
    const r = extractDominantColors(image([[RED, 10]], 0), { k: 2 });
    expect(r.paperPixels).toBe(10);
    expect(r.colors).toEqual([]);
  });

  it('imagem só de papel devolve lista vazia', () => {
    const r = extractDominantColors(image([[null, 25]]));
    expect(r.colors).toEqual([]);
    expect(r.paperPixels).toBe(25);
  });

  it('rejeita buffer cujo tamanho não é múltiplo de 4', () => {
    expect(() => extractDominantColors(new Uint8ClampedArray(7))).toThrow(/múltiplo de 4/);
  });

  it('é determinístico', () => {
    const img = image([[RED, 40], [BLUE, 35], [{ r: 10, g: 160, b: 80 }, 25]]);
    expect(extractDominantColors(img, { k: 3 })).toEqual(extractDominantColors(img, { k: 3 }));
  });
});
