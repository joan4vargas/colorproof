// Fluxo B, passo 1: de uma página rasterizada a uma grade de cores em Lab.
//
// Para comparar duas versões do mesmo layout sem alinhar pixel a pixel, cada
// página é dividida numa grade de `grid` x `grid` células, em coordenadas
// NORMALIZADAS (0 a 1). Assim as duas entradas podem ter resolução diferente.
// De cada célula guarda-se a cor MAIS FREQUENTE (moda), não a média: a média
// de uma borda entre duas cores é uma terceira cor que não existe no arquivo.
//
// Limite conhecido: elementos menores que uma célula, dentro de uma célula
// dominada por outra cor (ou por papel), não aparecem. A grade padrão (32 x 32)
// dá células de cerca de 6,6 x 9,3 mm numa página A4.

import { rgbToLabD50 } from '../../core/colorimetry';
import type { Lab } from '../../types/color';
import type { RenderingIntent } from '../icc/colorEngine';

export const DEFAULT_GRID = 32;
const PAPER_MIN_L = 99; // igual a dominantColors.ts

export interface GridCell {
  lab: Lab;
  /** A cor mais frequente da célula é papel (sem tinta). */
  paper: boolean;
  /** Fração dos pixels da célula que têm a cor escolhida (1 = célula uniforme). */
  share: number;
}

export interface LabGrid {
  grid: number;
  /** Razão largura/altura da página rasterizada. */
  aspect: number;
  /** grid x grid células, linha a linha, de cima para baixo. */
  cells: GridCell[];
}

export interface RgbaRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface CmykRaster extends RgbaRaster {}

/** O que a grade CMYK precisa do perfil (o `IccProfileHandle` atende). */
export interface CmykLabConverter {
  cmyk8ToLab(samples: ArrayLike<number>, intent?: RenderingIntent): Lab[];
}

function checkGrid(grid: number): void {
  if (!Number.isInteger(grid) || grid < 1 || grid > 256) {
    throw new Error(`labGrid: grade inválida (${grid}); use um inteiro de 1 a 256.`);
  }
}

/** Moda por célula. `keyAt(i)` devolve a chave (cor) do pixel `i`. */
function modePerCell(
  width: number,
  height: number,
  grid: number,
  keyAt: (pixel: number) => number,
): Array<{ key: number; share: number }> {
  const counts: Array<Map<number, number>> = Array.from({ length: grid * grid }, () => new Map());
  const cellTotals = new Int32Array(grid * grid);
  for (let y = 0; y < height; y++) {
    const row = Math.min(grid - 1, Math.floor((y * grid) / height));
    for (let x = 0; x < width; x++) {
      const col = Math.min(grid - 1, Math.floor((x * grid) / width));
      const cell = row * grid + col;
      const key = keyAt(y * width + x);
      const m = counts[cell];
      m.set(key, (m.get(key) ?? 0) + 1);
      cellTotals[cell] += 1;
    }
  }
  return counts.map((m, cell) => {
    let bestKey = 0;
    let bestCount = -1;
    for (const [key, n] of m) {
      // desempate determinístico: a menor chave
      if (n > bestCount || (n === bestCount && key < bestKey)) {
        bestKey = key;
        bestCount = n;
      }
    }
    return { key: bestKey, share: cellTotals[cell] > 0 ? bestCount / cellTotals[cell] : 0 };
  });
}

function checkRaster(r: RgbaRaster, name: string): void {
  if (r.width < 1 || r.height < 1 || r.data.length !== r.width * r.height * 4) {
    throw new Error(`${name}: raster inconsistente (${r.width}x${r.height}, ${r.data.length} bytes).`);
  }
}

/** Grade de cores de uma página em sRGB (RGBA). Pixels transparentes contam como papel. */
export function gridFromRgba(page: RgbaRaster, grid = DEFAULT_GRID): LabGrid {
  checkGrid(grid);
  checkRaster(page, 'gridFromRgba');
  const { width, height, data } = page;
  const modes = modePerCell(width, height, grid, (p) =>
    data[p * 4 + 3] < 255 ? 0xffffff : (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2],
  );
  const cells = modes.map(({ key, share }) => {
    const lab = rgbToLabD50({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 });
    return { lab, paper: lab.l >= PAPER_MIN_L, share };
  });
  return { grid, aspect: width / height, cells };
}

/** Grade de cores de uma página em CMYK de 8 bits (255 = 100%), com Lab pelo perfil. */
export function gridFromCmyk(
  page: CmykRaster,
  profile: CmykLabConverter,
  grid = DEFAULT_GRID,
  intent: RenderingIntent = 'relative',
): LabGrid {
  checkGrid(grid);
  checkRaster(page, 'gridFromCmyk');
  const { width, height, data } = page;
  // chave de 32 bits sem sinal (C, M, Y, K); `>>> 0` evita chaves negativas
  const modes = modePerCell(
    width,
    height,
    grid,
    (p) => ((data[p * 4] << 24) | (data[p * 4 + 1] << 16) | (data[p * 4 + 2] << 8) | data[p * 4 + 3]) >>> 0,
  );
  const samples = new Uint8Array(modes.length * 4);
  modes.forEach(({ key }, i) => {
    samples[i * 4] = (key >>> 24) & 255;
    samples[i * 4 + 1] = (key >>> 16) & 255;
    samples[i * 4 + 2] = (key >>> 8) & 255;
    samples[i * 4 + 3] = key & 255;
  });
  const labs = profile.cmyk8ToLab(samples, intent);
  const cells = modes.map(({ key, share }, i) => ({ lab: labs[i], paper: key === 0, share }));
  return { grid, aspect: width / height, cells };
}

