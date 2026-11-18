// Lista as cores spot (Separation, como o Pantone) que um PDF usa, com o que o
// arquivo declara sobre elas.
//
// Um spot no PDF é um nome (ex.: "PANTONE 186 C") mais um espaço de cor
// alternativo e uma função de tinta que leva a tinta (0 a 1) a esse espaço.
//  - Alternativo Lab (como o Illustrator e o InDesign gravam o Pantone): o Lab
//    é o valor de referência da cor, é o que interessa para casar com CMYK.
//  - Alternativo CMYK: é só um substituto aproximado que o arquivo carrega; NÃO
//    é o valor oficial do Pantone. Avisamos e pedimos o Lab.
// O arquivo não traz o catálogo Pantone: a biblioteca de cores é proprietária e
// não é distribuída com o app.
//
// Funções de tinta suportadas: tipo 2 (exponencial) e tipo 4 (PostScript
// simples). Outras ficam sem valor, com aviso.

import { adaptBradford, xyzToLab } from '../../core/colorimetry';
import type { Cmyk, Lab } from '../../types/color';
import type * as MuPdfNs from 'mupdf';
import type { MuPdf } from './cmykPdf';

export interface SpotColor {
  name: string;
  /** Espaço alternativo declarado pelo arquivo (Lab, DeviceCMYK, DeviceRGB, DeviceGray, ICCBased...). */
  alternate: string;
  /** Tintas (0 a 1) em que o spot é pintado no arquivo. */
  tints: number[];
  /** Lab (D50) a 100% de tinta, quando o alternativo é Lab. */
  lab?: Lab;
  /** CMYK (%) a 100% de tinta, quando o alternativo é CMYK. */
  cmyk?: Cmyk;
  note?: string;
}

type Obj = MuPdfNs.PDFObject;

// --- Função de tinta -----------------------------------------------------------------

/** Interpretador mínimo de PostScript das funções tipo 4 do PDF. */
export function runPsFunction(source: string, input: number[]): number[] {
  const body = source.slice(source.indexOf('{') + 1, source.lastIndexOf('}'));
  const tokens = body.replace(/[{}]/g, ' ').split(/\s+/).filter(Boolean);
  const st: number[] = [...input];
  const pop = () => {
    const v = st.pop();
    if (v === undefined) throw new Error('pilha vazia');
    return v;
  };
  for (const t of tokens) {
    const n = Number(t);
    if (!Number.isNaN(n)) {
      st.push(n);
      continue;
    }
    switch (t) {
      case 'add': { const b = pop(), a = pop(); st.push(a + b); break; }
      case 'sub': { const b = pop(), a = pop(); st.push(a - b); break; }
      case 'mul': { const b = pop(), a = pop(); st.push(a * b); break; }
      case 'div': { const b = pop(), a = pop(); st.push(a / b); break; }
      case 'neg': st.push(-pop()); break;
      case 'abs': st.push(Math.abs(pop())); break;
      case 'sqrt': st.push(Math.sqrt(pop())); break;
      case 'dup': { const a = pop(); st.push(a, a); break; }
      case 'pop': pop(); break;
      case 'exch': { const b = pop(), a = pop(); st.push(b, a); break; }
      case 'copy': { const n2 = pop(); st.push(...st.slice(st.length - n2)); break; }
      case 'index': { const i = pop(); st.push(st[st.length - 1 - i]); break; }
      case 'roll': {
        const j = pop(), n2 = pop();
        if (n2 > 0) {
          const part = st.splice(st.length - n2, n2);
          const k = ((j % n2) + n2) % n2;
          st.push(...part.slice(part.length - k), ...part.slice(0, part.length - k));
        }
        break;
      }
      default:
        throw new Error(`operador PostScript não suportado: ${t}`);
    }
  }
  return st;
}

function numbers(o: Obj | null | undefined): number[] | null {
  if (!o || o.isNull() || !o.isArray()) return null;
  const out: number[] = [];
  for (let i = 0; i < o.length; i++) out.push(o.get(i).asNumber());
  return out;
}

/** Avalia a função de tinta num ponto. Devolve null se o tipo não for suportado. */
function evalTint(fn: Obj, t: number): number[] | null {
  const type = fn.get('FunctionType').asNumber();
  if (type === 2) {
    const c0 = numbers(fn.get('C0')) ?? [0];
    const c1 = numbers(fn.get('C1')) ?? [1];
    const n = fn.get('N').asNumber();
    return c0.map((v, i) => v + Math.pow(t, n) * ((c1[i] ?? v) - v));
  }
  if (type === 4 && fn.isStream()) {
    const text = new TextDecoder('latin1').decode(fn.readStream().asUint8Array());
    const out = runPsFunction(text, [t]);
    const range = numbers(fn.get('Range'));
    return range ? out.map((v, i) => Math.min(Math.max(v, range[2 * i]), range[2 * i + 1])) : out;
  }
  return null;
}

// --- Espaço alternativo -----------------------------------------------------------------

function labFromPdfLab(cs: Obj, values: number[]): Lab {
  const dict = cs.get(1);
  const wp = numbers(dict.get('WhitePoint')) ?? [0.9642, 1, 0.8249];
  const range = numbers(dict.get('Range')) ?? [-100, 100, -100, 100];
  const [l, a0, b0] = values;
  const a = Math.min(Math.max(a0, range[0]), range[1]);
  const b = Math.min(Math.max(b0, range[2]), range[3]);
  // Lab do PDF -> XYZ pelo branco do próprio espaço -> Bradford para D50 -> Lab D50.
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number) => (f > 6 / 29 ? f ** 3 : (3 * (6 / 29) ** 2) * (f - 4 / 29));
  const xyz = { x: wp[0] * inv(fx) * 100, y: wp[1] * inv(fy) * 100, z: wp[2] * inv(fz) * 100 };
  const white = { x: wp[0] * 100, y: wp[1] * 100, z: wp[2] * 100 };
  return xyzToLab(adaptBradford(xyz, white));
}

interface SpotDef {
  alternate: string;
  alt: Obj;
  fn: Obj;
}

function describe(cs: Obj): SpotDef | null {
  if (!cs.isArray() || cs.length < 4 || !cs.get(0).isName() || cs.get(0).asName() !== 'Separation') return null;
  const alt = cs.get(2);
  const alternate = alt.isName() ? alt.asName() : alt.isArray() && alt.get(0).isName() ? alt.get(0).asName() : 'desconhecido';
  return { alternate, alt, fn: cs.get(3) };
}

function resourcesOf(node: Obj): Obj | null {
  for (let o: Obj = node, guard = 0; guard < 20 && !o.isNull(); guard++) {
    const r = o.get('Resources');
    if (!r.isNull()) return r;
    o = o.get('Parent');
  }
  return null;
}

/** Percorre os recursos de uma página (e dos formulários dentro dela) atrás dos espaços Separation. */
function collectSeparations(resources: Obj | null, out: Map<string, SpotDef>, seen: Set<number>, depth: number): void {
  if (!resources || resources.isNull() || depth > 4) return;
  const spaces = resources.get('ColorSpace');
  if (!spaces.isNull() && spaces.isDictionary()) {
    spaces.forEach((cs: Obj) => {
      const def = describe(cs.resolve());
      if (!def) return;
      const nameObj = cs.resolve().get(1);
      if (nameObj.isName()) out.set(nameObj.asName(), def);
    });
  }
  const xobjects = resources.get('XObject');
  if (!xobjects.isNull() && xobjects.isDictionary()) {
    xobjects.forEach((x: Obj) => {
      const id = x.isIndirect() ? x.asIndirect() : 0;
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      const form = x.resolve();
      if (form.get('Subtype').isName() && form.get('Subtype').asName() === 'Form') {
        collectSeparations(form.get('Resources'), out, seen, depth + 1);
      }
    });
  }
}

// --- API ---------------------------------------------------------------------------------

export function listSpotColors(mupdf: MuPdf, file: ArrayBuffer | Uint8Array, maxPages = 100): SpotColor[] {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  const doc = mupdf.Document.openDocument(bytes.slice(), 'application/pdf');
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new Error('O arquivo não é um PDF.');
  }
  try {
    const used = new Map<string, Set<number>>();
    const defs = new Map<string, SpotDef>();
    const seen = new Set<number>();
    const multi = new Set<string>();
    const numPages = Math.min(pdf.countPages(), maxPages);
    for (let n = 0; n < numPages; n++) {
      const page = pdf.loadPage(n) as MuPdfNs.PDFPage;
      try {
        const note = (cs: MuPdfNs.ColorSpace, color: number[]) => {
          if (cs.getType() !== 'Separation') return;
          const full = cs.getName();
          if (cs.getNumberOfComponents() > 1 || full.startsWith('DeviceN')) {
            multi.add(full);
            return;
          }
          const comma = full.indexOf(',');
          const name = full.slice(comma + 1, full.endsWith(')') ? -1 : undefined);
          if (!used.has(name)) used.set(name, new Set());
          used.get(name)!.add(Math.round(color[0] * 1000) / 1000);
        };
        const device = new mupdf.Device({
          fillPath: (_p, _e, _m, cs, color) => note(cs, color),
          strokePath: (_p, _s, _m, cs, color) => note(cs, color),
          fillText: (_t, _m, cs, color) => note(cs, color),
          strokeText: (_t, _s, _m, cs, color) => note(cs, color),
        });
        page.run(device, mupdf.Matrix.identity);
        device.close();
        device.destroy();
        collectSeparations(resourcesOf(page.getObject()), defs, seen, 0);
      } finally {
        page.destroy();
      }
    }

    const result: SpotColor[] = [];
    for (const [name, tints] of used) {
      const spot: SpotColor = { name, alternate: 'desconhecido', tints: [...tints].sort((a, b) => b - a) };
      const def = defs.get(name);
      if (!def) {
        spot.note = 'Não achei a definição desta cor nos recursos do arquivo.';
      } else {
        spot.alternate = def.alternate;
        try {
          const v = evalTint(def.fn, 1);
          if (!v) spot.note = 'A função de tinta deste spot é de um tipo que o app ainda não lê.';
          else if (def.alternate === 'Lab' && v.length >= 3) spot.lab = labFromPdfLab(def.alt, v);
          else if (def.alternate === 'DeviceCMYK' && v.length >= 4) spot.cmyk = { c: v[0] * 100, m: v[1] * 100, y: v[2] * 100, k: v[3] * 100 };
          else spot.note = `Alternativo ${def.alternate}: o app lê só Lab e CMYK.`;
        } catch (e) {
          spot.note = `Não consegui calcular a cor: ${e instanceof Error ? e.message : String(e)}.`;
        }
        if (spot.cmyk) {
          spot.note = 'O arquivo só traz um CMYK substituto, não o valor Lab do Pantone. Informe o Lab ou o hexadecimal oficial para um resultado confiável.';
        }
      }
      result.push(spot);
    }
    for (const m of multi) result.push({ name: m, alternate: 'DeviceN', tints: [], note: 'Espaço DeviceN (várias tintas): o app ainda não trata.' });
    return result;
  } finally {
    doc.destroy();
  }
}
