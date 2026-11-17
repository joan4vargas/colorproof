// Veredito por faixas de ΔE00 do "Fluxo A" (simulação de conformidade).
//
// Os limites são DECISÃO DE PROJETO (docs/DOCUMENTACAO.md, seção 8c, D2), não
// tolerâncias da ISO 12647-2: aprovado até 3,0, atenção de 3,0 a 4,0 e
// reprovado acima de 4,0. Fundamento: o piso de erro do próprio round-trip,
// medido em patches de caracterização, passa de 4 ΔE00 em no máximo 0,25% dos casos.

export type Verdict = 'aprovado' | 'atencao' | 'reprovado';

export interface VerdictThresholds {
  /** Até este valor (inclusive): aprovado. */
  approvedMax: number;
  /** Até este valor (inclusive): atenção; acima: reprovado. */
  attentionMax: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = { approvedMax: 3.0, attentionMax: 4.0 };

export function classifyDeltaE(
  deltaE: number,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): Verdict {
  if (!Number.isFinite(deltaE) || deltaE < 0) {
    throw new Error(`classifyDeltaE: ΔE inválido (${deltaE}).`);
  }
  if (thresholds.approvedMax > thresholds.attentionMax) {
    throw new Error('classifyDeltaE: o limite de aprovado não pode passar o de atenção.');
  }
  if (deltaE <= thresholds.approvedMax) return 'aprovado';
  if (deltaE <= thresholds.attentionMax) return 'atencao';
  return 'reprovado';
}

const ORDER: Record<Verdict, number> = { aprovado: 0, atencao: 1, reprovado: 2 };

/** O pior veredito de uma lista (o do laudo como um todo). Lista vazia: aprovado. */
export function worstVerdict(verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((w, v) => (ORDER[v] > ORDER[w] ? v : w), 'aprovado');
}
