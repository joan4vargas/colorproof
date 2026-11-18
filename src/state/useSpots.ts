// Estado da página "Cores spot": as linhas digitadas, o que veio do PDF e os resultados.

import { useCallback, useRef, useState } from 'react';
import type { RenderingIntent } from '../lib/icc/colorEngine';
import type { SpotColor } from '../lib/pdf/spotColors';
import type { SpotInput, SpotMatch } from '../lib/spot/spotMatch';
import type { Workspace } from './useWorkspace';

export type SpotMode = 'lab' | 'hex' | 'cmyk';

export interface SpotRow {
  id: number;
  name: string;
  mode: SpotMode;
  l: string;
  a: string;
  b: string;
  hex: string;
  c: string;
  m: string;
  y: string;
  k: string;
  /** De onde veio o valor (texto livre, aparece no laudo). */
  origin: string;
  /** Aviso sobre a confiabilidade do valor (ex.: CMYK substituto do arquivo). */
  warning?: string;
}

export interface SpotResult {
  matches: SpotMatch[];
  rows: SpotRow[];
  profileDescription: string;
  intent: RenderingIntent;
}

/** Campo vazio não é zero: devolve NaN, e a linha é recusada com um aviso. */
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;

/** Converte a linha digitada num valor de referência, ou explica o que está errado. */
export function rowToInput(row: SpotRow): { input: SpotInput } | { error: string } {
  const name = row.name.trim() || 'Sem nome';
  if (row.mode === 'lab') {
    const [l, a, b] = [num(row.l), num(row.a), num(row.b)];
    if (!inRange(l, 0, 100) || !inRange(a, -160, 160) || !inRange(b, -160, 160)) {
      return { error: `${name}: preencha L*, a* e b* (L* de 0 a 100; a* e b* de −160 a 160).` };
    }
    return { input: { name, ref: { kind: 'lab', lab: { l, a, b } } } };
  }
  if (row.mode === 'hex') {
    const m = /^#?([0-9a-f]{6})$/i.exec(row.hex.trim());
    if (!m) return { error: `${name}: preencha o hexadecimal com 6 dígitos, como #E4002B.` };
    const v = parseInt(m[1], 16);
    return { input: { name, ref: { kind: 'srgb', rgb: { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 } } } };
  }
  const [c, m, y, k] = [num(row.c), num(row.m), num(row.y), num(row.k)];
  if (![c, m, y, k].every((v) => inRange(v, 0, 100))) return { error: `${name}: preencha C, M, Y e K (de 0 a 100).` };
  return { input: { name, ref: { kind: 'cmyk', cmyk: { c, m, y, k } } } };
}

let nextId = 1;
export const blankRow = (): SpotRow => ({ id: nextId++, name: '', mode: 'lab', l: '', a: '', b: '', hex: '', c: '', m: '', y: '', k: '', origin: 'digitado' });

const fix = (v: number) => v.toFixed(2).replace('.', ',');

function rowFromSpot(s: SpotColor): SpotRow {
  const row = blankRow();
  row.name = s.name;
  if (s.lab) {
    Object.assign(row, { mode: 'lab', l: fix(s.lab.l), a: fix(s.lab.a), b: fix(s.lab.b), origin: 'Lab declarado no PDF' });
  } else if (s.cmyk) {
    Object.assign(row, { mode: 'cmyk', c: fix(s.cmyk.c), m: fix(s.cmyk.m), y: fix(s.cmyk.y), k: fix(s.cmyk.k), origin: 'CMYK substituto do PDF', warning: s.note });
  } else {
    row.warning = s.note ?? 'O arquivo não traz um valor que o app leia. Digite o Lab ou o hexadecimal.';
  }
  return row;
}

export function useSpots(ws: Workspace) {
  const [rows, setRows] = useState<SpotRow[]>(() => [blankRow()]);
  const [intent, setIntent] = useState<RenderingIntent>('relative');
  const [result, setResult] = useState<SpotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const runId = useRef(0);

  const update = useCallback((id: number, patch: Partial<SpotRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);
  const add = useCallback(() => setRows((rs) => [...rs, blankRow()]), []);
  const remove = useCallback((id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : [blankRow()])), []);

  /** Lê os spots do PDF e junta às linhas; devolve as linhas novas (ou null se nada mudou). */
  const readFromPdf = useCallback(async (): Promise<SpotRow[] | null> => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const spots = await ws.listSpots();
      if (spots.length === 0) {
        setInfo('Este PDF não usa cores spot (Pantone etc.).');
        return null;
      }
      const filled = rows.filter((r) => r.name.trim() || r.l || r.hex || r.c);
      const known = new Set(filled.map((r) => r.name.trim()));
      const next = [...filled, ...spots.filter((s) => !known.has(s.name)).map(rowFromSpot)];
      setRows(next);
      setInfo(`${spots.length} cor(es) spot encontrada(s) no PDF.`);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [ws, rows]);

  const calculate = useCallback(async (rowsOverride?: SpotRow[]) => {
    setError(null);
    setInfo(null);
    const used = (rowsOverride ?? rows).filter((r) => r.name.trim() || r.l || r.hex || r.c || r.m || r.y || r.k);
    if (used.length === 0) {
      setError('Informe ao menos uma cor.');
      return;
    }
    const inputs: SpotInput[] = [];
    for (const row of used) {
      const parsed = rowToInput(row);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      inputs.push(parsed.input);
    }
    const id = ++runId.current;
    setBusy(true);
    try {
      const out = await ws.matchSpots(inputs, intent);
      if (id === runId.current) setResult({ ...out, rows: used, intent });
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }, [rows, intent, ws]);

  /** Atalho do banner da visão geral: lê os spots do PDF e já calcula o CMYK de cada um. */
  const readAndCalculate = useCallback(async () => {
    const next = await readFromPdf();
    if (next) await calculate(next);
  }, [readFromPdf, calculate]);

  return { rows, intent, setIntent, result, busy, error, info, update, add, remove, readFromPdf, calculate, readAndCalculate };
}
