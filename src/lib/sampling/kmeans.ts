// Fase 4 do roteiro: clusterização das cores dominantes de uma imagem
// rasterizada, usada para gerar as "amostras" que aparecem no laudo
// (decisão tomada em vez de parsing de content stream vetorial — ver
// discussão sobre escopo do TCC).
//
// Implementação própria e simples de k-means, já operando em espaço Lab
// (não RGB), porque distância euclidiana em Lab se aproxima melhor de
// diferença perceptual do que em RGB — o que é coerente com o resto do
// pipeline colorimétrico do projeto.

import type { Lab } from '../../types/color';

export interface ClusterResult {
  centroid: Lab;
  /** Proporção de pixels da imagem que pertence a este cluster (0-1). */
  weight: number;
}

function labDistanceSquared(a: Lab, b: Lab): number {
  // Distância euclidiana simples em Lab — suficiente para a etapa de
  // clusterização. O laudo final usa CIEDE2000 (mais caro), não esta função.
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dl * dl + da * da + db * db;
}

function pickInitialCentroids(points: Lab[], k: number): Lab[] {
  // Inicialização simples por amostragem espaçada. Se o projeto evoluir e
  // a qualidade dos clusters for insuficiente, substituir por k-means++.
  const step = Math.max(1, Math.floor(points.length / k));
  const centroids: Lab[] = [];
  for (let i = 0; i < k && i * step < points.length; i++) {
    centroids.push({ ...points[i * step] });
  }
  return centroids;
}

/**
 * Agrupa uma lista de cores Lab em `k` clusters representativos.
 *
 * @param points cores Lab extraídas da imagem (uma entrada por pixel amostrado)
 * @param k número de amostras representativas desejadas no laudo
 * @param maxIterations limite de segurança para evitar loop longo em imagens grandes
 */
export function kmeansLab(points: Lab[], k: number, maxIterations = 20): ClusterResult[] {
  if (points.length === 0) return [];
  const effectiveK = Math.min(k, points.length);

  let centroids = pickInitialCentroids(points, effectiveK);
  let assignments = new Array<number>(points.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Etapa de atribuição: cada ponto vai para o centróide mais próximo.
    for (let i = 0; i < points.length; i++) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dist = labDistanceSquared(points[i], centroids[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = c;
        }
      }
      if (assignments[i] !== bestIdx) {
        assignments[i] = bestIdx;
        changed = true;
      }
    }

    if (!changed && iter > 0) break;

    // Etapa de atualização: recalcula cada centróide como a média do seu cluster.
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, count: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assignments[i]];
      s.l += points[i].l;
      s.a += points[i].a;
      s.b += points[i].b;
      s.count += 1;
    }
    centroids = sums.map((s, idx) =>
      s.count > 0
        ? { l: s.l / s.count, a: s.a / s.count, b: s.b / s.count }
        : centroids[idx],
    );
  }

  const counts = new Array(centroids.length).fill(0);
  for (const a of assignments) counts[a] += 1;

  return centroids.map((centroid, idx) => ({
    centroid,
    weight: counts[idx] / points.length,
  }));
}
