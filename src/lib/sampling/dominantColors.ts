// Das cores de uma imagem rasterizada (RGBA, sRGB) às cores dominantes.
//
// Passos:
// 1. histograma exato de cores RGB distintas (sem quantização, para não
//    deslocar as cores que depois serão comparadas com tolerâncias de ΔE);
// 2. exclusão do "papel": pixels quase brancos não são tinta e, em PDFs, a
//    folha em branco costuma ocupar a maior parte da página;
// 3. conversão de cada cor distinta para Lab D50 (núcleo `src/core`);
// 4. k-means ponderado em Lab.
//
// Premissa: os pixels estão em sRGB (é o que o Canvas entrega). Para PDFs com
// CMYK, o pdf.js já converteu para sRGB antes de chegarmos aqui, com uma
// conversão aproximada e sem perfil ICC (ver docs, seção 9, limitação L13).

import { rgbToLabD50 } from '../../core/colorimetry';
import type { Lab, RGB } from '../../types/color';
import { kmeansLabWeighted, mostFrequentPerCluster, type WeightedLab } from './kmeans';

export interface DominantColor {
  /** Centróide do cluster, em Lab D50. */
  lab: Lab;
  /** Cor mais frequente do cluster, em sRGB (existe de fato no arquivo). */
  rgb: RGB;
  /** Fração dos pixels de tinta (sem papel) que pertence ao cluster (0-1). */
  inkShare: number;
  /** Fração de todos os pixels, papel incluído (0-1). */
  pixelShare: number;
  /** ΔE00 médio entre os membros e o centróide (ver `ClusterResult.spread`). */
  spread: number;
}

export interface ColorExtraction {
  colors: DominantColor[];
  totalPixels: number;
  /** Pixels descartados por serem papel (ou transparentes). */
  paperPixels: number;
  /** Cores RGB distintas encontradas entre os pixels de tinta. */
  distinctColors: number;
}

export interface ExtractionOptions {
  /** Número de cores dominantes desejado (padrão 8). */
  k?: number;
  /** Descarta pixels com L* >= `paperMinL` (padrão: true). */
  excludePaper?: boolean;
  /** L* a partir do qual um pixel conta como papel (padrão 99). */
  paperMinL?: number;
  /** Pixels com alfa abaixo disto são ignorados (padrão 255: só opacos). */
  alphaMin?: number;
}

function unpack(key: number): RGB {
  return { r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 };
}

/**
 * Extrai as cores dominantes de pixels RGBA (4 bytes por pixel, sRGB).
 *
 * O resultado é determinístico: a mesma imagem sempre devolve os mesmos
 * clusters, na mesma ordem (do mais para o menos frequente).
 */
export function extractDominantColors(
  rgba: Uint8ClampedArray | Uint8Array,
  options: ExtractionOptions = {},
): ColorExtraction {
  const { k = 8, excludePaper = true, paperMinL = 99, alphaMin = 255 } = options;
  if (rgba.length % 4 !== 0) {
    throw new Error('extractDominantColors: o buffer RGBA precisa ter múltiplo de 4 bytes.');
  }
  const totalPixels = rgba.length / 4;

  const histogram = new Map<number, number>();
  let transparent = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaMin) {
      transparent += 1;
      continue;
    }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }

  const points: WeightedLab[] = [];
  const rgbOf: RGB[] = [];
  let paperPixels = transparent;
  for (const [key, count] of histogram) {
    const rgb = unpack(key);
    const lab = rgbToLabD50(rgb);
    if (excludePaper && lab.l >= paperMinL) {
      paperPixels += count;
      continue;
    }
    points.push({ lab, count });
    rgbOf.push(rgb);
  }

  const inkPixels = totalPixels - paperPixels;
  const clusters = kmeansLabWeighted(points, k);

  const representative = mostFrequentPerCluster(points, clusters);

  const colors: DominantColor[] = clusters.map((c, idx) => ({
    lab: c.centroid,
    rgb: rgbOf[representative[idx]],
    inkShare: c.weight,
    pixelShare: (c.weight * inkPixels) / totalPixels,
    spread: c.spread,
  }));

  return { colors, totalPixels, paperPixels, distinctColors: points.length };
}
