// Fase 4 do roteiro: clusterização das cores dominantes de uma imagem
// rasterizada, usada para gerar as "amostras" que aparecem no laudo
// (decisão tomada em vez de parsing de content stream vetorial).
//
// K-means próprio, em espaço Lab (e não RGB), porque a distância euclidiana
// em Lab se aproxima melhor da diferença perceptual. A clusterização usa a
// distância euclidiana (ΔE76) só para agrupar; o veredito do laudo usa
// CIEDE2000 (mais caro), nunca esta função.
//
// Duas escolhas que tornam o resultado reprodutível (mesma entrada, mesma
// saída, o que é necessário para testar e para citar no trabalho):
// - os pontos podem ter peso (contagem de pixels de cada cor distinta), então
//   a imagem inteira entra no cálculo sem amostragem aleatória;
// - a inicialização é determinística, no estilo k-means++ guloso: o primeiro
//   centróide é a cor de maior peso e cada seguinte é o ponto que maximiza
//   peso x distância² até o centróide mais próximo.

import { deltaE2000 } from '../../core/colorimetry';
import type { Lab } from '../../types/color';

export interface WeightedLab {
  lab: Lab;
  /** Quantos pixels têm esta cor (> 0). */
  count: number;
}

export interface ClusterResult {
  centroid: Lab;
  /** Proporção dos pixels (ponderada) que pertence a este cluster (0-1). */
  weight: number;
  /**
   * ΔE00 médio (ponderado) entre os membros e o centróide. Mede quanto o
   * centróide "representa" de fato o cluster: valor alto indica que o cluster
   * junta cores diferentes (ex.: um degradê) e o centróide pode não ser uma
   * cor que existe no arquivo.
   */
  spread: number;
}

function distSq(a: Lab, b: Lab): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dl * dl + da * da + db * db;
}

function initialCentroids(points: WeightedLab[], k: number): Lab[] {
  let first = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].count > points[first].count) first = i;
  }
  const centroids: Lab[] = [{ ...points[first].lab }];
  const minDist = points.map((p) => distSq(p.lab, centroids[0]));

  while (centroids.length < k) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < points.length; i++) {
      const score = minDist[i] * points[i].count;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // Todos os pontos restantes coincidem com algum centróide: não há como
    // separar mais clusters.
    if (best < 0) break;
    const c = { ...points[best].lab };
    centroids.push(c);
    for (let i = 0; i < points.length; i++) {
      const d = distSq(points[i].lab, c);
      if (d < minDist[i]) minDist[i] = d;
    }
  }
  return centroids;
}

/**
 * Agrupa cores Lab ponderadas em até `k` clusters.
 *
 * Devolve no máximo `k` clusters (menos, se houver menos cores distintas),
 * ordenados do mais para o menos frequente.
 */
export function kmeansLabWeighted(
  points: WeightedLab[],
  k: number,
  maxIterations = 30,
): ClusterResult[] {
  if (points.length === 0 || k < 1) return [];

  let centroids = initialCentroids(points, Math.min(k, points.length));
  const assignments = new Int32Array(points.length);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let i = 0; i < points.length; i++) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(points[i].lab, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = c;
        }
      }
      if (assignments[i] !== bestIdx) {
        assignments[i] = bestIdx;
        changed = true;
      }
    }

    if (!changed && iter > 0) break;

    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assignments[i]];
      const w = points[i].count;
      s.l += points[i].lab.l * w;
      s.a += points[i].lab.a * w;
      s.b += points[i].lab.b * w;
      s.n += w;
    }
    centroids = sums.map((s, idx) =>
      s.n > 0 ? { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n } : centroids[idx],
    );
  }

  const total = points.reduce((s, p) => s + p.count, 0);
  const acc = centroids.map(() => ({ n: 0, spread: 0 }));
  for (let i = 0; i < points.length; i++) {
    const a = acc[assignments[i]];
    a.n += points[i].count;
    a.spread += points[i].count * deltaE2000(points[i].lab, centroids[assignments[i]]);
  }

  return centroids
    .map((centroid, idx) => ({
      centroid,
      weight: acc[idx].n / total,
      spread: acc[idx].n > 0 ? acc[idx].spread / acc[idx].n : 0,
    }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

/** Versão sem pesos: cada ponto vale um pixel. */
export function kmeansLab(points: Lab[], k: number, maxIterations = 30): ClusterResult[] {
  return kmeansLabWeighted(
    points.map((lab) => ({ lab, count: 1 })),
    k,
    maxIterations,
  );
}

/**
 * Para cada cluster, o índice do ponto mais frequente entre os seus membros
 * (os membros de um cluster são os pontos mais próximos do seu centróide).
 * O centróide é uma média e pode não existir no arquivo; este ponto existe.
 */
export function mostFrequentPerCluster(points: WeightedLab[], clusters: ClusterResult[]): number[] {
  const best = clusters.map(() => -1);
  for (let i = 0; i < points.length; i++) {
    let idx = 0;
    let bestD = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const d = distSq(points[i].lab, clusters[c].centroid);
      if (d < bestD) {
        bestD = d;
        idx = c;
      }
    }
    if (best[idx] < 0 || points[i].count > points[best[idx]].count) best[idx] = i;
  }
  return best;
}
