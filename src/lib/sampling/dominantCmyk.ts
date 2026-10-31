// Das cores de um pixmap CMYK às cores dominantes, passando pelo perfil ICC.
//
// É o caminho do "híbrido" para PDFs em CMYK: os números C, M, Y, K lidos do
// arquivo (sem conversão para RGB) são levados a Lab pelo perfil escolhido,
// com a tabela A2B, e agrupados como em `dominantColors.ts`.
//
// Convenção dos pixmaps de 8 bits: 255 = 100% de tinta; papel = 0/0/0/0.

import type { Cmyk, Lab } from '../../types/color';
import type { RenderingIntent } from '../icc/colorEngine';
import { kmeansLabWeighted, mostFrequentPerCluster, type WeightedLab } from './kmeans';

/** O que este módulo precisa do perfil (o `IccProfileHandle` atende). */
export interface CmykToLabConverter {
  cmyk8ToLab(samples: ArrayLike<number>, intent?: RenderingIntent): Lab[];
}

export interface DominantCmykColor {
  /** Centróide do cluster, em Lab (pelo perfil). */
  lab: Lab;
  /** Cor CMYK real mais frequente do cluster, em % de tinta (existe no arquivo). */
  cmyk: Cmyk;
  /** Fração dos pixels com tinta (sem papel) que pertence ao cluster (0-1). */
  inkShare: number;
  /** Fração de todos os pixels, papel incluído (0-1). */
  pixelShare: number;
  /** ΔE00 médio entre os membros e o centróide. */
  spread: number;
}

export interface CmykExtraction {
  colors: DominantCmykColor[];
  totalPixels: number;
  /** Pixels sem nenhuma tinta (C = M = Y = K = 0). */
  paperPixels: number;
  distinctColors: number;
}

export interface CmykExtractionOptions {
  /** Número de cores dominantes desejado (padrão 8). */
  k?: number;
  /** Rendering intent da conversão para Lab (padrão: relativo, como no motor). */
  intent?: RenderingIntent;
  /** Descarta os pixels sem tinta nenhuma (padrão: true). */
  excludePaper?: boolean;
}

const toPercent = (v: number) => (v / 255) * 100;

/**
 * Extrai as cores dominantes de um pixmap CMYK (4 bytes por pixel).
 * Determinístico: mesma imagem e mesmo perfil dão o mesmo resultado.
 */
export function extractDominantCmykColors(
  samples: Uint8ClampedArray | Uint8Array,
  converter: CmykToLabConverter,
  options: CmykExtractionOptions = {},
): CmykExtraction {
  const { k = 8, intent = 'relative', excludePaper = true } = options;
  if (samples.length % 4 !== 0) {
    throw new Error('extractDominantCmykColors: o buffer CMYK precisa ter múltiplo de 4 bytes.');
  }
  const totalPixels = samples.length / 4;

  // Histograma exato de cores CMYK distintas. A chave usa 32 bits sem sinal.
  const histogram = new Map<number, number>();
  for (let i = 0; i < samples.length; i += 4) {
    const key =
      ((samples[i] << 24) | (samples[i + 1] << 16) | (samples[i + 2] << 8) | samples[i + 3]) >>> 0;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }

  let paperPixels = 0;
  const keys: number[] = [];
  const counts: number[] = [];
  for (const [key, count] of histogram) {
    if (excludePaper && key === 0) {
      paperPixels += count;
      continue;
    }
    keys.push(key);
    counts.push(count);
  }

  const bytes = new Uint8Array(keys.length * 4);
  keys.forEach((key, i) => {
    bytes[i * 4] = key >>> 24;
    bytes[i * 4 + 1] = (key >>> 16) & 255;
    bytes[i * 4 + 2] = (key >>> 8) & 255;
    bytes[i * 4 + 3] = key & 255;
  });
  const labs = converter.cmyk8ToLab(bytes, intent);
  const points: WeightedLab[] = labs.map((lab, i) => ({ lab, count: counts[i] }));

  const inkPixels = totalPixels - paperPixels;
  const clusters = kmeansLabWeighted(points, k);
  const representative = mostFrequentPerCluster(points, clusters);

  const colors: DominantCmykColor[] = clusters.map((c, idx) => {
    const r = representative[idx] * 4;
    return {
      lab: c.centroid,
      cmyk: {
        c: toPercent(bytes[r]),
        m: toPercent(bytes[r + 1]),
        y: toPercent(bytes[r + 2]),
        k: toPercent(bytes[r + 3]),
      },
      inkShare: c.weight,
      pixelShare: (c.weight * inkPixels) / totalPixels,
      spread: c.spread,
    };
  });

  return { colors, totalPixels, paperPixels, distinctColors: points.length };
}
