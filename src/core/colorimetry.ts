// Núcleo matemático do pipeline (Fase 2 do roteiro).
//
// Este módulo é deliberadamente independente de DOM, Canvas ou Web Workers:
// recebe números, devolve números. Isso permite testá-lo isoladamente no
// Vitest com valores de referência publicados, antes de integrar qualquer
// perfil ICC real (Fase 3) ou UI (Fase 8).
//
// Pipeline coberto aqui: sRGB -> XYZ (D65) -> adaptação de Bradford (D65->D50)
// -> CIE L*a*b* (D50) -> CIEDE2000.
//
// Observação importante para a monografia: estas conversões partem de um
// sRGB "assumido" (sem perfil embutido). A extração de cor real de um PDF
// (Fase 4) e a transformação por perfil ICC via lcms2-wasm (Fase 3) é que
// vão gerar o Lab "de verdade" usado no laudo — este módulo cobre a
// matemática de referência e serve de base de validação para essa etapa.

import { ILLUMINANT_D50, type Lab, type RGB, type XYZ } from '../types/color';

// --- 1. sRGB -> XYZ (D65) -----------------------------------------------

/** Remove a curva de gama sRGB, devolvendo o valor linear no intervalo [0,1]. */
function srgbChannelToLinear(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Matriz sRGB -> XYZ (D65), valores padrão da especificação sRGB (IEC 61966-2-1).
const SRGB_TO_XYZ_D65: readonly (readonly number[])[] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

/** Converte sRGB (0-255) para XYZ absoluto (D65), escala 0-100. */
export function rgbToXyzD65(rgb: RGB): XYZ {
  const rLin = srgbChannelToLinear(rgb.r);
  const gLin = srgbChannelToLinear(rgb.g);
  const bLin = srgbChannelToLinear(rgb.b);

  const [m0, m1, m2] = SRGB_TO_XYZ_D65;
  return {
    x: (rLin * m0[0] + gLin * m0[1] + bLin * m0[2]) * 100,
    y: (rLin * m1[0] + gLin * m1[1] + bLin * m1[2]) * 100,
    z: (rLin * m2[0] + gLin * m2[1] + bLin * m2[2]) * 100,
  };
}

// --- 2. Adaptação cromática de Bradford (D65 -> D50) ---------------------
//
// Necessária porque o PCS (Profile Connection Space) dos perfis ICC usa
// D50 como branco de referência, enquanto monitores/sRGB assumem D65.
// Sem essa etapa, qualquer comparação contra um perfil ICC (FOGRA39,
// ISOcoated_v2) estaria partindo de um branco de referência inconsistente.

const BRADFORD_MATRIX: readonly (readonly number[])[] = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

const BRADFORD_MATRIX_INV: readonly (readonly number[])[] = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];

function applyMatrix(m: readonly (readonly number[])[], v: XYZ): XYZ {
  return {
    x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
    y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
    z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
  };
}

/**
 * Adapta um XYZ do branco de referência de origem para o de destino
 * usando a transformação de Bradford. Por padrão: D65 -> D50.
 */
export function adaptBradford(
  xyz: XYZ,
  sourceWhite: XYZ = { x: 95.047, y: 100.0, z: 108.883 }, // D65
  targetWhite: XYZ = { x: 96.422, y: 100.0, z: 82.521 }, // D50
): XYZ {
  const src = applyMatrix(BRADFORD_MATRIX, sourceWhite);
  const dst = applyMatrix(BRADFORD_MATRIX, targetWhite);

  const scale = {
    x: dst.x / src.x,
    y: dst.y / src.y,
    z: dst.z / src.z,
  };

  const cone = applyMatrix(BRADFORD_MATRIX, xyz);
  const adaptedCone: XYZ = {
    x: cone.x * scale.x,
    y: cone.y * scale.y,
    z: cone.z * scale.z,
  };

  return applyMatrix(BRADFORD_MATRIX_INV, adaptedCone);
}

// --- 3. XYZ (D50) -> CIE L*a*b* ------------------------------------------

function labF(t: number): number {
  const delta = 6 / 29;
  return t > Math.pow(delta, 3) ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

/** Converte XYZ (assumido já adaptado para D50) em CIE L*a*b*. */
export function xyzToLab(xyz: XYZ, whitePoint = ILLUMINANT_D50): Lab {
  const fx = labF(xyz.x / whitePoint.x);
  const fy = labF(xyz.y / whitePoint.y);
  const fz = labF(xyz.z / whitePoint.z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** Atalho: sRGB (0-255) -> Lab (D50), já passando pela adaptação de Bradford. */
export function rgbToLabD50(rgb: RGB): Lab {
  const xyzD65 = rgbToXyzD65(rgb);
  const xyzD50 = adaptBradford(xyzD65);
  return xyzToLab(xyzD50);
}

// --- 4. CIEDE2000 ----------------------------------------------------------
//
// Implementação da fórmula CIEDE2000 (Sharma, Wu & Dalal, 2005).
// Os testes unitários (core/__tests__/colorimetry.test.ts) validam esta
// função contra a tabela de 34 pares de referência publicada nesse artigo,
// que é o dataset padrão usado para verificar implementações de CIEDE2000.

const deg2rad = (deg: number) => (deg * Math.PI) / 180;
const rad2deg = (rad: number) => (rad * 180) / Math.PI;

export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const { l: L1, a: a1, b: b1 } = lab1;
  const { l: L2, a: a2, b: b2 } = lab2;

  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const CBar = (C1 + C2) / 2;

  const G =
    0.5 * (1 - Math.sqrt(Math.pow(CBar, 7) / (Math.pow(CBar, 7) + Math.pow(25, 7))));

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = a1p === 0 && b1 === 0 ? 0 : (rad2deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = a2p === 0 && b2 === 0 ? 0 : (rad2deg(Math.atan2(b2, a2p)) + 360) % 360;

  const deltaLp = L2 - L1;
  const deltaCp = C2p - C1p;

  let deltahp = 0;
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) deltahp = diff;
    else if (diff > 180) deltahp = diff - 360;
    else deltahp = diff + 360;
  }
  const deltaHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(deltahp) / 2);

  const LBarp = (L1 + L2) / 2;
  const CBarp = (C1p + C2p) / 2;

  let hBarp: number;
  if (C1p * C2p === 0) {
    hBarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarp = (h1p + h2p + 360) / 2;
  } else {
    hBarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(deg2rad(hBarp - 30)) +
    0.24 * Math.cos(deg2rad(2 * hBarp)) +
    0.32 * Math.cos(deg2rad(3 * hBarp + 6)) -
    0.2 * Math.cos(deg2rad(4 * hBarp - 63));

  const deltaTheta = 30 * Math.exp(-Math.pow((hBarp - 275) / 25, 2));

  const RC = 2 * Math.sqrt(Math.pow(CBarp, 7) / (Math.pow(CBarp, 7) + Math.pow(25, 7)));

  const SL = 1 + (0.015 * Math.pow(LBarp - 50, 2)) / Math.sqrt(20 + Math.pow(LBarp - 50, 2));
  const SC = 1 + 0.045 * CBarp;
  const SH = 1 + 0.015 * CBarp * T;

  const RT = -Math.sin(deg2rad(2 * deltaTheta)) * RC;

  const termL = deltaLp / (kL * SL);
  const termC = deltaCp / (kC * SC);
  const termH = deltaHp / (kH * SH);

  return Math.sqrt(
    termL * termL + termC * termC + termH * termH + RT * termC * termH,
  );
}

// --- 5. Lab (D50) -> sRGB, só para EXIBIÇÃO ------------------------------
//
// Usada para desenhar uma amostra na tela de uma cor que só existe em Lab
// (por exemplo, a de um CMYK lido de um PDF). Cores fora do gamut do sRGB são
// recortadas, então a amostra é uma aproximação visual: o valor que vale para o
// laudo é sempre o Lab, nunca este RGB.

function invert3x3(m: readonly (readonly number[])[]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const XYZ_D65_TO_SRGB = invert3x3(SRGB_TO_XYZ_D65);

function labToXyz(lab: Lab, whitePoint = ILLUMINANT_D50): XYZ {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const delta = 6 / 29;
  const inv = (t: number) => (t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29));
  return { x: inv(fx) * whitePoint.x, y: inv(fy) * whitePoint.y, z: inv(fz) * whitePoint.z };
}

function linearToSrgbChannel(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** Lab (D50) -> sRGB (0-255), recortando o que sai do gamut. Só para exibição. */
export function labD50ToRgbClipped(lab: Lab): RGB {
  const xyzD65 = adaptBradford(labToXyz(lab), ILLUMINANT_D50, { x: 95.047, y: 100.0, z: 108.883 });
  const lin = applyMatrix(XYZ_D65_TO_SRGB, { x: xyzD65.x / 100, y: xyzD65.y / 100, z: xyzD65.z / 100 });
  return {
    r: linearToSrgbChannel(lin.x),
    g: linearToSrgbChannel(lin.y),
    b: linearToSrgbChannel(lin.z),
  };
}
