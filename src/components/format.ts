// Formatação e utilidades de arquivo usadas pelas telas.

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const fmtCmyk = (c: { c: number; m: number; y: number; k: number }) =>
  `${c.c.toFixed(0)} / ${c.m.toFixed(0)} / ${c.y.toFixed(0)} / ${c.k.toFixed(0)}`;
export const fmtLab = (l: { l: number; a: number; b: number }) => `${l.l.toFixed(1)} / ${l.a.toFixed(1)} / ${l.b.toFixed(1)}`;
export const mimeOf = (f: File) => (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.type || 'image/png');
export const isPdf = (f: File) => mimeOf(f) === 'application/pdf';
