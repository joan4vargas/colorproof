// Fluxo B: referência contra simulação, do mesmo layout.
//
// Entrada: duas grades de cor (`labGrid.ts`), uma por versão do arquivo, página
// a página. Cada célula é comparada em ΔE00 com a célula de mesma posição.
// Células que são papel nas duas versões não entram na conta.
//
// Veredito geral: pelo percentil 95 dos ΔE00 das células, não pelo pior caso.
// O pior caso é dominado por células de borda, onde um deslocamento de poucos
// pixels entre as duas versões basta para trocar a cor dominante da célula.
// O pior caso e as piores células são informados à parte.
// As faixas de ΔE00 são as de `verdict.ts` (decisão D2).

import { deltaE2000 } from '../../core/colorimetry';
import { DEFAULT_THRESHOLDS, classifyDeltaE, worstVerdict, type Verdict, type VerdictThresholds } from '../../core/verdict';
import type { Lab } from '../../types/color';
import type { LabGrid } from './labGrid';

export interface PageComparison {
  pageNumber: number;
  /** Células comparadas (as que não são papel nas duas versões). */
  compared: number;
  meanDeltaE: number;
  p95DeltaE: number;
  maxDeltaE: number;
  /** Participação de cada faixa entre as células comparadas (0-1). */
  shares: Record<Verdict, number>;
  verdict: Verdict;
  /** Veredito pelo pior caso (informativo, mais rígido). */
  worstCaseVerdict: Verdict;
  worst: WorstCell[];
  /** Razão largura/altura da página (para desenhar o mapa de regiões na proporção certa). */
  aspect: number;
  /** ΔE00 de cada região (grade x grade, linha a linha, de cima para baixo); null = papel nas duas versões. */
  deltaEGrid: Array<number | null>;
}

export interface WorstCell {
  row: number;
  col: number;
  deltaE: number;
  reference: Lab;
  simulation: Lab;
  /** Fração uniforme da célula nas duas versões (o menor dos dois). Baixo = célula mista. */
  minShare: number;
}

export interface FlowBReport {
  grid: number;
  thresholds: VerdictThresholds;
  pages: PageComparison[];
  verdict: Verdict;
  warnings: string[];
}

export interface FlowBOptions {
  thresholds?: VerdictThresholds;
  /** Quantas piores células guardar por página (padrão 5). */
  worstCount?: number;
  /** Diferença máxima aceita entre as proporções das páginas (padrão 2%). */
  aspectTolerance?: number;
}

/** As duas versões não têm o mesmo layout (proporção da página diferente). */
export class LayoutMismatchError extends Error {
  constructor(page: number, a: number, b: number) {
    super(
      `Página ${page}: as duas versões têm proporções diferentes (${a.toFixed(3)} e ${b.toFixed(3)}). ` +
        'O Fluxo B compara regiões na mesma posição e exige o mesmo layout.',
    );
    this.name = 'LayoutMismatchError';
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
}

export function comparePage(
  pageNumber: number,
  reference: LabGrid,
  simulation: LabGrid,
  options: FlowBOptions = {},
): PageComparison {
  const { thresholds = DEFAULT_THRESHOLDS, worstCount = 5, aspectTolerance = 0.02 } = options;
  if (reference.grid !== simulation.grid) {
    throw new Error(`comparePage: grades de tamanhos diferentes (${reference.grid} e ${simulation.grid}).`);
  }
  if (Math.abs(reference.aspect / simulation.aspect - 1) > aspectTolerance) {
    throw new LayoutMismatchError(pageNumber, reference.aspect, simulation.aspect);
  }

  const items: WorstCell[] = [];
  const deltaEGrid: Array<number | null> = new Array(reference.cells.length).fill(null);
  reference.cells.forEach((r, i) => {
    const s = simulation.cells[i];
    if (r.paper && s.paper) return;
    deltaEGrid[i] = deltaE2000(r.lab, s.lab);
    items.push({
      row: Math.floor(i / reference.grid),
      col: i % reference.grid,
      deltaE: deltaE2000(r.lab, s.lab),
      reference: r.lab,
      simulation: s.lab,
      minShare: Math.min(r.share, s.share),
    });
  });

  const sorted = items.map((c) => c.deltaE).sort((a, b) => a - b);
  const n = sorted.length;
  const shares: Record<Verdict, number> = { aprovado: 0, atencao: 0, reprovado: 0 };
  for (const d of sorted) shares[classifyDeltaE(d, thresholds)] += n > 0 ? 1 / n : 0;
  const p95 = percentile(sorted, 0.95);
  const max = n > 0 ? sorted[n - 1] : 0;

  return {
    pageNumber,
    compared: n,
    meanDeltaE: n > 0 ? sorted.reduce((a, b) => a + b, 0) / n : 0,
    p95DeltaE: p95,
    maxDeltaE: max,
    shares,
    verdict: classifyDeltaE(p95, thresholds),
    worstCaseVerdict: classifyDeltaE(max, thresholds),
    worst: [...items].sort((a, b) => b.deltaE - a.deltaE).slice(0, worstCount),
    deltaEGrid,
    aspect: reference.aspect,
  };
}

export function compareGrids(
  reference: LabGrid[],
  simulation: LabGrid[],
  options: FlowBOptions = {},
): FlowBReport {
  const { thresholds = DEFAULT_THRESHOLDS } = options;
  const warnings: string[] = [];
  if (reference.length === 0 || simulation.length === 0) {
    throw new Error('compareGrids: falta pelo menos uma página em cada versão.');
  }
  if (reference.length !== simulation.length) {
    warnings.push(
      `As versões têm número de páginas diferente (${reference.length} e ${simulation.length}); só as ${Math.min(
        reference.length,
        simulation.length,
      )} primeiras foram comparadas.`,
    );
  }
  const total = Math.min(reference.length, simulation.length);
  const pages: PageComparison[] = [];
  for (let i = 0; i < total; i++) pages.push(comparePage(i + 1, reference[i], simulation[i], options));

  if (pages.every((p) => p.compared === 0)) {
    warnings.push('Nenhuma região com tinta foi encontrada para comparar.');
  }
  if (pages.some((p) => p.worst.some((w) => w.minShare < 0.5))) {
    warnings.push(
      'Algumas das piores regiões são mistas (bordas ou fotografias): um deslocamento pequeno entre as versões já muda a cor dominante dali.',
    );
  }
  return {
    grid: reference[0].grid,
    thresholds,
    pages,
    verdict: worstVerdict(pages.map((p) => p.verdict)),
    warnings,
  };
}
