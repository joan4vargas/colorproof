// Arte chapada (decisão do projeto, sem base normativa), compartilhada entre os caminhos CMYK e RGB.
//
// Quando as FLAT_TOP cores exatas mais frequentes cobrem pelo menos FLAT_COVERAGE da tinta, o
// arquivo é tratado como arte chapada. Nela, as bordas de texto e de filetes geram dezenas de
// misturas (antialiasing) entre duas tintas reais, que não são cores do trabalho: aparecem como
// "roxos" e "azuis claros" falsos. Fotos e degradês não passam no teste e seguem pelo k-means.
//
// Os pixels vêm em grupos de 4 bytes (CMYK, ou RGB com o 4º byte em 0).

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

export const dist2 = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => {
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
export function flatInks(bytes: Uint8Array, counts: number[], inkPixels: number, paper: Uint8Array = new Uint8Array(4)): number[] | null {
  const order = counts.map((_, i) => i).sort((x, y) => counts[y] - counts[x]);
  const top = order.slice(0, FLAT_TOP).reduce((s, i) => s + counts[i], 0);
  if (inkPixels === 0 || top / inkPixels < FLAT_COVERAGE) return null;

  const minCount = Math.max(FLAT_MIN_PIXELS, FLAT_MIN_SHARE * inkPixels);
  const cand = order.filter((i) => counts[i] >= minCount).slice(0, FLAT_MAX_BASES);
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
 * Cada cor exata vai para a tinta chapada mais próxima; o que fica mais perto do papel (bordas
 * claras) sai da conta. Devolve o peso (pixels) de cada tinta, na ordem de `flat`.
 */
export function assignToInks(bytes: Uint8Array, counts: number[], flat: number[], paper: Uint8Array = new Uint8Array(4)): number[] {
  const weight = new Array<number>(flat.length).fill(0);
  for (let i = 0; i < counts.length; i++) {
    let best = -1;
    let bestD = dist2(bytes, i * 4, paper, 0);
    for (let f = 0; f < flat.length; f++) {
      const d = dist2(bytes, i * 4, bytes, flat[f] * 4);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best >= 0) weight[best] += counts[i];
  }
  return weight;
}
