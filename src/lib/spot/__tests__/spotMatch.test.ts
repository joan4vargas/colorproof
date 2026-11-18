import { describe, expect, it } from 'vitest';
import { deltaE2000 } from '../../../core/colorimetry';
import type { Cmyk, Lab } from '../../../types/color';
import { matchSpot, type SpotProfile } from '../spotMatch';

// Perfil de mentira: A2B linear simples e B2A "ruim" (de propósito, para a busca ter o que melhorar).
const a2b = (c: Cmyk): Lab => ({
  l: 100 - 0.55 * c.c - 0.45 * c.m - 0.25 * c.y - 0.7 * c.k,
  a: 0.9 * c.m - 0.7 * c.c + 0.1 * c.y,
  b: 0.8 * c.y - 0.5 * c.c,
});
const fake: SpotProfile = {
  description: 'perfil de teste',
  cmykToLab: a2b,
  labToCmyk: (lab) => ({ c: 0, m: Math.min(100, Math.max(0, lab.a + 10)), y: 0, k: 0 }), // chute grosseiro
};

describe('matchSpot', () => {
  it('cor alcançável: a busca chega perto do alvo e melhora a B2A', () => {
    const target = a2b({ c: 20, m: 70, y: 60, k: 5 });
    const r = matchSpot({ name: 'teste', ref: { kind: 'lab', lab: target } }, fake);
    expect(r.deltaE).toBeLessThan(1.5);
    expect(r.deltaE).toBeLessThan(r.deltaEB2A);
    expect(r.improved).toBe(true);
    expect(r.reproducible).toBe(true);
    expect(r.verdict).toBe('aprovado');
  });

  it('cor fora do gamut: não chega, devolve a melhor aproximação e reprova', () => {
    const r = matchSpot({ name: 'neon', ref: { kind: 'lab', lab: { l: 60, a: 200, b: 150 } } }, fake);
    expect(r.reproducible).toBe(false);
    expect(r.verdict).toBe('reprovado');
    expect(r.deltaE).toBeGreaterThan(4);
    expect(r.cmyk.m).toBeGreaterThan(r.cmyk.c); // vai para o lado do magenta/amarelo, onde a cor está
  });

  it('o resultado nunca é pior que o da B2A e os valores são inteiros entre 0 e 100', () => {
    for (const lab of [{ l: 40, a: 30, b: 10 }, { l: 80, a: -10, b: 40 }, { l: 20, a: 5, b: 5 }]) {
      const r = matchSpot({ name: 'x', ref: { kind: 'lab', lab } }, fake);
      expect(r.deltaE).toBeLessThanOrEqual(r.deltaEB2A + 1e-9);
      for (const v of Object.values(r.cmyk)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(r.totalInk).toBeLessThanOrEqual(300 + 1e-9);
      expect(deltaE2000(r.labTarget, lab)).toBeCloseTo(0, 9);
    }
  });

  it('aceita sRGB e CMYK como referência', () => {
    const srgb = matchSpot({ name: 'x', ref: { kind: 'srgb', rgb: { r: 200, g: 40, b: 60 } } }, fake);
    expect(srgb.labTarget.l).toBeGreaterThan(30);
    const cmyk = matchSpot({ name: 'y', ref: { kind: 'cmyk', cmyk: { c: 10, m: 80, y: 70, k: 0 } } }, fake);
    expect(cmyk.deltaE).toBeLessThan(1.5);
  });

  it('respeita limites de aprovação personalizados', () => {
    const lab = { l: 60, a: 200, b: 150 };
    const r = matchSpot({ name: 'x', ref: { kind: 'lab', lab } }, fake, { thresholds: { approvedMax: 100, attentionMax: 200 } });
    expect(r.verdict).toBe('aprovado');
  });

  it('a segunda opção difere em pelo menos 5 pontos e nunca é melhor que a primeira', () => {
    const r = matchSpot({ name: 'x', ref: { kind: 'lab', lab: { l: 55, a: 50, b: 40 } } }, fake);
    const diff = Math.max(...(['c', 'm', 'y', 'k'] as const).map((ch) => Math.abs(r.alternative.cmyk[ch] - r.cmyk[ch])));
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(r.alternative.deltaE).toBeGreaterThanOrEqual(r.deltaE - 1e-9);
    expect(r.alternative.deltaEExtra).toBeCloseTo(r.alternative.deltaE - r.deltaE, 9);
  });
});
