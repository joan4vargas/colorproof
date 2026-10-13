import { describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLabD50, xyzToLab, adaptBradford, rgbToXyzD65 } from '../colorimetry';
import type { Lab, RGB, XYZ } from '../../types/color';

// =========================================================================
// 1. CIEDE2000 — dataset completo de Sharma, Wu & Dalal (2005)
// =========================================================================
//
// Os 34 pares abaixo vêm da Tabela 1 de: Sharma, G.; Wu, W.; Dalal, E. N.
// "The CIEDE2000 color-difference formula: implementation notes,
// supplementary test data, and mathematical observations". Color Research
// & Application, 30(1), 21-30, 2005. É o conjunto padrão da literatura
// para verificar implementações de CIEDE2000: inclui os casos em que
// implementações ingênuas erram (descontinuidade do ângulo de matiz,
// cores neutras, pares com diferenças grandes).
//
// Os valores esperados têm 4 casas decimais, como publicado. Além de
// compará-los com o artigo, os 34 pares foram conferidos contra uma
// implementação independente (colour-science 0.4.7, Python): zero
// divergências no nível de 4 casas decimais.

interface ReferencePair {
  id: number;
  lab1: Lab;
  lab2: Lab;
  expected: number;
}

const lab = (l: number, a: number, b: number): Lab => ({ l, a, b });

const SHARMA_PAIRS: readonly ReferencePair[] = [
  { id: 1, lab1: lab(50, 2.6772, -79.7751), lab2: lab(50, 0, -82.7485), expected: 2.0425 },
  { id: 2, lab1: lab(50, 3.1571, -77.2803), lab2: lab(50, 0, -82.7485), expected: 2.8615 },
  { id: 3, lab1: lab(50, 2.8361, -74.02), lab2: lab(50, 0, -82.7485), expected: 3.4412 },
  { id: 4, lab1: lab(50, -1.3802, -84.2814), lab2: lab(50, 0, -82.7485), expected: 1.0 },
  { id: 5, lab1: lab(50, -1.1848, -84.8006), lab2: lab(50, 0, -82.7485), expected: 1.0 },
  { id: 6, lab1: lab(50, -0.9009, -85.5211), lab2: lab(50, 0, -82.7485), expected: 1.0 },
  { id: 7, lab1: lab(50, 0, 0), lab2: lab(50, -1, 2), expected: 2.3669 },
  { id: 8, lab1: lab(50, -1, 2), lab2: lab(50, 0, 0), expected: 2.3669 },
  { id: 9, lab1: lab(50, 2.49, -0.001), lab2: lab(50, -2.49, 0.0009), expected: 7.1792 },
  { id: 10, lab1: lab(50, 2.49, -0.001), lab2: lab(50, -2.49, 0.001), expected: 7.1792 },
  { id: 11, lab1: lab(50, 2.49, -0.001), lab2: lab(50, -2.49, 0.0011), expected: 7.2195 },
  { id: 12, lab1: lab(50, 2.49, -0.001), lab2: lab(50, -2.49, 0.0012), expected: 7.2195 },
  { id: 13, lab1: lab(50, -0.001, 2.49), lab2: lab(50, 0.0009, -2.49), expected: 4.8045 },
  { id: 14, lab1: lab(50, -0.001, 2.49), lab2: lab(50, 0.001, -2.49), expected: 4.8045 },
  { id: 15, lab1: lab(50, -0.001, 2.49), lab2: lab(50, 0.0011, -2.49), expected: 4.7461 },
  { id: 16, lab1: lab(50, 2.5, 0), lab2: lab(50, 0, -2.5), expected: 4.3065 },
  { id: 17, lab1: lab(50, 2.5, 0), lab2: lab(73, 25, -18), expected: 27.1492 },
  { id: 18, lab1: lab(50, 2.5, 0), lab2: lab(61, -5, 29), expected: 22.8977 },
  { id: 19, lab1: lab(50, 2.5, 0), lab2: lab(56, -27, -3), expected: 31.903 },
  { id: 20, lab1: lab(50, 2.5, 0), lab2: lab(58, 24, 15), expected: 19.4535 },
  { id: 21, lab1: lab(50, 2.5, 0), lab2: lab(50, 3.1736, 0.5854), expected: 1.0 },
  { id: 22, lab1: lab(50, 2.5, 0), lab2: lab(50, 3.2972, 0), expected: 1.0 },
  { id: 23, lab1: lab(50, 2.5, 0), lab2: lab(50, 1.8634, 0.5757), expected: 1.0 },
  { id: 24, lab1: lab(50, 2.5, 0), lab2: lab(50, 3.2592, 0.335), expected: 1.0 },
  { id: 25, lab1: lab(60.2574, -34.0099, 36.2677), lab2: lab(60.4626, -34.1751, 39.4387), expected: 1.2644 },
  { id: 26, lab1: lab(63.0109, -31.0961, -5.8663), lab2: lab(62.8187, -29.7946, -4.0864), expected: 1.263 },
  { id: 27, lab1: lab(61.2901, 3.7196, -5.3901), lab2: lab(61.4292, 2.248, -4.962), expected: 1.8731 },
  { id: 28, lab1: lab(35.0831, -44.1164, 3.7933), lab2: lab(35.0232, -40.0716, 1.5901), expected: 1.8645 },
  { id: 29, lab1: lab(22.7233, 20.0904, -46.694), lab2: lab(23.0331, 14.973, -42.5619), expected: 2.0373 },
  { id: 30, lab1: lab(36.4612, 47.858, 18.3852), lab2: lab(36.2715, 50.5065, 21.2231), expected: 1.4146 },
  { id: 31, lab1: lab(90.8027, -2.0831, 1.441), lab2: lab(91.1528, -1.6435, 0.0447), expected: 1.4441 },
  { id: 32, lab1: lab(90.9257, -0.5406, -0.9208), lab2: lab(88.6381, -0.8985, -0.7239), expected: 1.5381 },
  { id: 33, lab1: lab(6.7747, -0.2908, -2.4247), lab2: lab(5.8714, -0.0985, -2.2286), expected: 0.6377 },
  { id: 34, lab1: lab(2.0776, 0.0795, -1.135), lab2: lab(0.9033, -0.0636, -0.5514), expected: 0.9082 },
];

describe('CIEDE2000 — dataset completo de Sharma, Wu & Dalal (2005), 34 pares', () => {
  it('o dataset tem exatamente 34 pares, numerados de 1 a 34', () => {
    expect(SHARMA_PAIRS).toHaveLength(34);
    expect(SHARMA_PAIRS.map((p) => p.id)).toEqual(Array.from({ length: 34 }, (_, i) => i + 1));
  });

  it.each(SHARMA_PAIRS)('par $id: ΔE00 ≈ $expected', ({ lab1, lab2, expected }) => {
    expect(deltaE2000(lab1, lab2)).toBeCloseTo(expected, 4);
  });

  it('é simétrico em todos os 34 pares: ΔE00(A,B) === ΔE00(B,A)', () => {
    for (const { lab1, lab2 } of SHARMA_PAIRS) {
      expect(deltaE2000(lab1, lab2)).toBeCloseTo(deltaE2000(lab2, lab1), 9);
    }
  });

  it('retorna 0 para duas cores idênticas', () => {
    const c: Lab = lab(62.3, 15.1, -22.4);
    expect(deltaE2000(c, c)).toBeCloseTo(0, 9);
  });
});

// =========================================================================
// 2. Pipeline sRGB -> XYZ (D65) -> Bradford -> Lab (D50)
// =========================================================================

describe('Pipeline sRGB -> XYZ (D65) -> Bradford -> Lab (D50)', () => {
  it('branco puro (255,255,255) mapeia para L* ≈ 100 e croma ≈ 0', () => {
    const w = rgbToLabD50({ r: 255, g: 255, b: 255 });
    expect(w.l).toBeCloseTo(100, 2);
    expect(Math.abs(w.a)).toBeLessThan(0.01);
    expect(Math.abs(w.b)).toBeLessThan(0.01);
  });

  it('preto puro (0,0,0) mapeia para L* ≈ 0', () => {
    expect(rgbToLabD50({ r: 0, g: 0, b: 0 }).l).toBeCloseTo(0, 1);
  });

  it('adaptação de Bradford é a identidade quando origem === destino', () => {
    // Tolerância de 4 casas decimais (não 6): a matriz de Bradford e sua
    // inversa não são exatamente inversas em ponto flutuante de 64 bits,
    // e o erro acumulado fica na ordem de 1e-6 em XYZ. Irrelevante para
    // ΔE, mas o teste não deve exigir mais precisão do que a aritmética
    // de ponto flutuante realmente entrega.
    const xyz = rgbToXyzD65({ r: 120, g: 80, b: 200 });
    const white: XYZ = { x: 95.047, y: 100, z: 108.883 };
    const adapted = adaptBradford(xyz, white, white);
    expect(adapted.x).toBeCloseTo(xyz.x, 4);
    expect(adapted.y).toBeCloseTo(xyz.y, 4);
    expect(adapted.z).toBeCloseTo(xyz.z, 4);
  });

  it('adaptação de Bradford leva o branco D65 exatamente ao branco D50', () => {
    const d65: XYZ = { x: 95.047, y: 100, z: 108.883 };
    const out = adaptBradford(d65); // padrão: D65 -> D50
    expect(out.x).toBeCloseTo(96.422, 3);
    expect(out.y).toBeCloseTo(100, 3);
    expect(out.z).toBeCloseTo(82.521, 3);
  });

  it('xyzToLab é consistente para o próprio branco de referência (L*=100, a*=b*=0)', () => {
    const d50: XYZ = { x: 96.422, y: 100.0, z: 82.521 };
    const c = xyzToLab(d50, d50);
    expect(c.l).toBeCloseTo(100, 6);
    expect(c.a).toBeCloseTo(0, 6);
    expect(c.b).toBeCloseTo(0, 6);
  });

  it('cinza médio (128,128,128) tem L* ≈ 53,585 e croma ≈ 0', () => {
    // 53,585 é o L* do cinza sRGB 128 (conferido também contra colour-science).
    const g = rgbToLabD50({ r: 128, g: 128, b: 128 });
    expect(g.l).toBeCloseTo(53.585, 2);
    expect(Math.abs(g.a)).toBeLessThan(0.01);
    expect(Math.abs(g.b)).toBeLessThan(0.01);
  });

  it('rampa de cinzas (0..255): croma ≈ 0 e L* estritamente crescente', () => {
    let previousL = -Infinity;
    for (let v = 0; v <= 255; v += 5) {
      const c = rgbToLabD50({ r: v, g: v, b: v });
      expect(Math.abs(c.a)).toBeLessThan(0.02);
      expect(Math.abs(c.b)).toBeLessThan(0.02);
      expect(c.l).toBeGreaterThan(previousL);
      previousL = c.l;
    }
  });
});

// Referências geradas com colour-science 0.4.7 (implementação independente):
// sRGB com decodificação de gama, matriz derivada das primárias sRGB,
// adaptação Bradford para D50 (CIE 1931 2°) e Lab em D50.
//
// As duas implementações não são idênticas bit a bit: a matriz sRGB
// do projeto usa os coeficientes arredondados da especificação, enquanto
// a referência a deriva das primárias. Isso gera diferenças da ordem de
// 0,01 a 0,03 em a*/b* para cores saturadas. Por isso a comparação é
// feita em ΔE00 (escala perceptual), com limiar de 0,05, muito abaixo
// do que é perceptível (≈ 1) e do que importa para o laudo.
interface PipelineReference {
  nome: string;
  rgb: RGB;
  lab: Lab;
}

const PIPELINE_REFERENCES: readonly PipelineReference[] = [
  { nome: 'vermelho', rgb: { r: 255, g: 0, b: 0 }, lab: lab(54.2866, 80.8251, 69.9134) },
  { nome: 'verde', rgb: { r: 0, g: 255, b: 0 }, lab: lab(87.82, -79.2722, 80.9958) },
  { nome: 'azul', rgb: { r: 0, g: 0, b: 255 }, lab: lab(29.5705, 68.2915, -112.0238) },
  { nome: 'amarelo', rgb: { r: 255, g: 255, b: 0 }, lab: lab(97.6067, -15.7435, 93.3992) },
  { nome: 'ciano', rgb: { r: 0, g: 255, b: 255 }, lab: lab(90.6678, -50.6544, -14.9569) },
  { nome: 'magenta', rgb: { r: 255, g: 0, b: 255 }, lab: lab(60.1663, 93.5587, -60.5011) },
  { nome: 'cinza 18%', rgb: { r: 46, g: 46, b: 46 }, lab: lab(18.9373, 0.0024, 0.0011) },
  { nome: 'laranja', rgb: { r: 255, g: 128, b: 0 }, lab: lab(67.8145, 45.5018, 74.8519) },
  { nome: 'marrom', rgb: { r: 120, g: 72, b: 24 }, lab: lab(35.7511, 18.0758, 36.1459) },
  { nome: 'verde escuro', rgb: { r: 40, g: 80, b: 40 }, lab: lab(30.2832, -21.9332, 18.9512) },
];

describe('Pipeline sRGB -> Lab (D50) contra implementação independente (colour-science)', () => {
  it.each(PIPELINE_REFERENCES)('$nome: ΔE00 < 0,05 em relação à referência', ({ rgb, lab: expected }) => {
    expect(deltaE2000(rgbToLabD50(rgb), expected)).toBeLessThan(0.05);
  });
});
