import { describe, expect, it } from 'vitest';
import { kmeansLab, kmeansLabWeighted } from '../kmeans';
import type { Lab } from '../../../types/color';

const RED: Lab = { l: 50, a: 70, b: 50 };
const GREEN: Lab = { l: 70, a: -60, b: 50 };
const BLUE: Lab = { l: 30, a: 20, b: -70 };

/** Pequena dispersão determinística em torno de uma cor. */
function around(center: Lab, n: number, amp = 1): Lab[] {
  return Array.from({ length: n }, (_, i) => ({
    l: center.l + ((i % 3) - 1) * amp,
    a: center.a + ((i % 5) - 2) * (amp / 2),
    b: center.b + ((i % 7) - 3) * (amp / 3),
  }));
}

describe('kmeansLab / kmeansLabWeighted', () => {
  it('entrada vazia ou k < 1 devolve lista vazia', () => {
    expect(kmeansLab([], 3)).toEqual([]);
    expect(kmeansLab([RED], 0)).toEqual([]);
  });

  it('separa três grupos distantes, com pesos e centróides corretos', () => {
    const points = [...around(RED, 60), ...around(GREEN, 30), ...around(BLUE, 10)];
    const clusters = kmeansLab(points, 3);
    expect(clusters).toHaveLength(3);
    // Ordenados do mais para o menos frequente.
    expect(clusters.map((c) => c.weight)).toEqual([0.6, 0.3, 0.1]);
    const near = (c: Lab, ref: Lab) => Math.hypot(c.l - ref.l, c.a - ref.a, c.b - ref.b);
    expect(near(clusters[0].centroid, RED)).toBeLessThan(1);
    expect(near(clusters[1].centroid, GREEN)).toBeLessThan(1);
    expect(near(clusters[2].centroid, BLUE)).toBeLessThan(1);
  });

  it('os pesos somam 1', () => {
    const clusters = kmeansLab([...around(RED, 20), ...around(BLUE, 20)], 4);
    expect(clusters.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 10);
  });

  it('com pesos equivale a repetir os pontos', () => {
    const weighted = kmeansLabWeighted(
      [
        { lab: RED, count: 7 },
        { lab: GREEN, count: 2 },
        { lab: BLUE, count: 1 },
      ],
      3,
    );
    const repeated = kmeansLab(
      [...Array(7).fill(RED), ...Array(2).fill(GREEN), ...Array(1).fill(BLUE)],
      3,
    );
    expect(weighted).toEqual(repeated);
  });

  it('é determinístico: a mesma entrada dá o mesmo resultado', () => {
    const points = [...around(RED, 40, 3), ...around(GREEN, 40, 3), ...around(BLUE, 40, 3)];
    expect(kmeansLab(points, 5)).toEqual(kmeansLab(points, 5));
  });

  it('com k maior que o número de cores distintas, devolve só as distintas', () => {
    const clusters = kmeansLab([RED, RED, GREEN], 8);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].weight).toBeCloseTo(2 / 3, 10);
  });

  it('spread é zero para cor única e positivo para grupo disperso', () => {
    expect(kmeansLab([RED, RED, RED], 1)[0].spread).toBeLessThan(1e-9);
    const spread = kmeansLab(around(RED, 30, 6), 1)[0].spread;
    expect(spread).toBeGreaterThan(0.5);
  });

  it('uma cor minoritária bem distinta não é engolida por uma majoritária', () => {
    // 99,9% de uma cor e 0,1% de outra: com k = 2 as duas devem aparecer.
    const clusters = kmeansLabWeighted(
      [
        { lab: BLUE, count: 999 },
        { lab: RED, count: 1 },
      ],
      2,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[1].weight).toBeCloseTo(0.001, 6);
  });
});
