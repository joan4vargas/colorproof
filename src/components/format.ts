// Formatação e utilidades de arquivo usadas pelas telas.

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const fmtCmyk = (c: { c: number; m: number; y: number; k: number }) =>
  `${c.c.toFixed(0)} / ${c.m.toFixed(0)} / ${c.y.toFixed(0)} / ${c.k.toFixed(0)}`;
export const fmtLab = (l: { l: number; a: number; b: number }) => `${l.l.toFixed(1)} / ${l.a.toFixed(1)} / ${l.b.toFixed(1)}`;
export const mimeOf = (f: File) => (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.type || 'image/png');
export const isPdf = (f: File) => mimeOf(f) === 'application/pdf';
export const hexOf = (c: { r: number; g: number; b: number }) =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const num2 = (v: number) => v.toFixed(2).replace('.', ',');
/** Mudança de tinta em pontos percentuais; só as que passam de 1 ponto, ex.: "M −7, K +3". */
export function inkChanges(ch: { c: number; m: number; y: number; k: number }): string {
  const parts = (['c', 'm', 'y', 'k'] as const)
    .filter((k) => Math.abs(ch[k]) >= 1)
    .map((k) => `${k.toUpperCase()} ${ch[k] > 0 ? '+' : '−'}${Math.abs(ch[k]).toFixed(0)}`);
  return parts.join(', ');
}
