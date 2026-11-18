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
  /**
   * true quando o arquivo é arte chapada (poucas cores cobrem quase tudo): as cores vêm
   * das tintas chapadas e as misturas de borda (antialiasing) foram descartadas.
   */
  flatArt?: boolean;
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

// Arte chapada (decisão do projeto, sem base normativa): quando as FLAT_TOP cores exatas mais
// frequentes cobrem pelo menos FLAT_COVERAGE da tinta, o arquivo é tratado como arte chapada.
// Nela, as bordas de texto e de filetes geram dezenas de misturas (antialiasing) entre duas
// tintas reais, que não são cores do trabalho: aparecem como "roxos" e "azuis claros" falsos.
// Fotos e degradês não passam no teste e seguem pelo agrupamento k-means.
const FLAT_TOP = 12;
const FLAT_COVERAGE = 0.6;
/** Cor com menos pixels que isto (fração da tinta, mínimo de 4 px) não vira cor dominante. */
const FLAT_MIN_SHARE = 0.0002;
const FLAT_MIN_PIXELS = 4;
/** Distância (escala 0-255 dos 4 canais) abaixo da qual uma cor "está no segmento" de duas outras. */
const BLEND_TOLERANCE = 6;
const FLAT_MAX_BASES = 40;
/** Uma cor exata com tanta tinta assim é área chapada de verdade (um tom, por exemplo), nunca borda. */
const FLAT_SAFE_SHARE = 0.02;

const dist2 = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => {
  let d = 0;
  for (let j = 0; j < 4; j++) d += (a[ai + j] - b[bi + j]) ** 2;
  return d;
};

/** A cor `c` fica sobre o segmento a–b (mistura de borda)? Distância do ponto ao segmento no espaço CMYK. */
function onSegment(c: ArrayLike<number>, ci: number, a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): boolean {
  let ab2 = 0;
  let t = 0;
  for (let j = 0; j < 4; j++) {
    const d = b[bi + j] - a[ai + j];
    ab2 += d * d;
    t += (c[ci + j] - a[ai + j]) * d;
  }
  if (ab2 === 0) return false;
  t /= ab2;
  if (t <= 0 || t >= 1) return false;
  let d2 = 0;
  for (let j = 0; j < 4; j++) {
    const p = a[ai + j] + t * (b[bi + j] - a[ai + j]);
    d2 += (c[ci + j] - p) ** 2;
  }
  return d2 <= BLEND_TOLERANCE * BLEND_TOLERANCE;
}

/**
 * Escolhe as tintas chapadas: cores exatas frequentes que não são mistura de outras duas
 * (nem de uma tinta com o papel). Devolve os índices no vetor `counts`/`bytes`, ou null se não é arte chapada.
 */
function flatInks(bytes: Uint8Array, counts: number[], inkPixels: number): number[] | null {
  const order = counts.map((_, i) => i).sort((x, y) => counts[y] - counts[x]);
  const top = order.slice(0, FLAT_TOP).reduce((s, i) => s + counts[i], 0);
  if (inkPixels === 0 || top / inkPixels < FLAT_COVERAGE) return null;

  const minCount = Math.max(FLAT_MIN_PIXELS, FLAT_MIN_SHARE * inkPixels);
  const cand = order.filter((i) => counts[i] >= minCount).slice(0, FLAT_MAX_BASES);
  const paper = new Uint8Array(4); // 0/0/0/0
  const countOf = (i: number) => (i < 0 ? Infinity : counts[i]);
  // Mistura só conta se for menos frequente que as duas pontas (o papel conta como infinito) e
  // tiver menos de FLAT_SAFE_SHARE da tinta: uma área chapada grande, mesmo sobre o segmento de
  // outras duas, é cor do trabalho. Limite conhecido: um tom pequeno (< 2% da tinta) entre uma
  // tinta e o papel é tratado como borda.
  const isBlend = (i: number, others: number[]): boolean => {
    if (counts[i] >= FLAT_SAFE_SHARE * inkPixels) return false;
    const pool = [-1, ...others];
    for (let x = 0; x < pool.length; x++) {
      for (let y = x + 1; y < pool.length; y++) {
        const a = pool[x];
        const b = pool[y];
        if (counts[i] >= countOf(a) || counts[i] >= countOf(b)) continue;
        const A = a < 0 ? paper : bytes;
        const B = b < 0 ? paper : bytes;
        if (onSegment(bytes, i * 4, A, a < 0 ? 0 : a * 4, B, b < 0 ? 0 : b * 4)) return true;
      }
    }
    return false;
  };

  let bases = cand;
  for (let pass = 0; pass < 4; pass++) {
    const next = bases.filter((i) => !isBlend(i, bases.filter((o) => o !== i)));
    if (next.length === bases.length) break;
    bases = next;
  }
  return bases.length > 0 ? bases : null;
}

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

  const flat = flatInks(bytes, counts, inkPixels);
  if (flat) {
    // Cada pixel de tinta vai para a tinta chapada mais próxima (no espaço CMYK); o que fica mais
    // perto do papel (bordas claras) sai da conta.
    const weight = new Array<number>(flat.length).fill(0);
    for (let i = 0; i < keys.length; i++) {
      let best = -1;
      let bestD = dist2(bytes, i * 4, new Uint8Array(4), 0);
      for (let f = 0; f < flat.length; f++) {
        const d = dist2(bytes, i * 4, bytes, flat[f] * 4);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best >= 0) weight[best] += counts[i];
    }
    const assigned = weight.reduce((a, b) => a + b, 0) || 1;
    const colors = flat
      .map((idx, f): DominantCmykColor => ({
        lab: labs[idx],
        cmyk: { c: toPercent(bytes[idx * 4]), m: toPercent(bytes[idx * 4 + 1]), y: toPercent(bytes[idx * 4 + 2]), k: toPercent(bytes[idx * 4 + 3]) },
        inkShare: weight[f] / assigned,
        pixelShare: weight[f] / totalPixels,
        spread: 0,
      }))
      .sort((x, y) => y.inkShare - x.inkShare)
      .slice(0, k);
    return { colors, totalPixels, paperPixels, distinctColors: points.length, flatArt: true };
  }

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
