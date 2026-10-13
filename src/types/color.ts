// Tipos base usados em todo o pipeline colorimétrico.
// Mantidos separados do core matemático para poderem ser importados
// tanto pela UI quanto pelos Web Workers sem trazer lógica junto.

export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export interface Lab {
  l: number; // 0-100
  a: number; // tipicamente -128 a 127
  b: number; // tipicamente -128 a 127
}

// Ponto branco de referência, usado na conversão XYZ <-> Lab
// e como alvo da adaptação cromática de Bradford.
export interface WhitePoint {
  x: number;
  y: number;
  z: number;
}

// Iluminantes padrão mais usados no pipeline:
// D65 = branco de referência de monitores (sRGB)
// D50 = branco de referência do PCS de perfis ICC
export const ILLUMINANT_D65: WhitePoint = { x: 95.047, y: 100.0, z: 108.883 };
export const ILLUMINANT_D50: WhitePoint = { x: 96.422, y: 100.0, z: 82.521 };
