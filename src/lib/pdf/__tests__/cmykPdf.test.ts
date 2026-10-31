import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { concatCmykPages, inspectPdfColorUsage, renderPdfPagesCmyk, type MuPdf } from '../cmykPdf';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const load = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

let mupdf: MuPdf;
beforeAll(async () => {
  mupdf = await import('mupdf');
});

/** Valor CMYK (0-255) do pixel (x, y) de uma página de 200 px de largura. */
function pixel(data: Uint8ClampedArray, x: number, y: number, width = 200): string {
  const o = (y * width + x) * 4;
  return Array.from(data.slice(o, o + 4)).join('/');
}

describe('inspectPdfColorUsage', () => {
  it('PDF só em CMYK', () => {
    const u = inspectPdfColorUsage(mupdf, load('cores-cmyk.pdf'));
    expect(u.hasCmyk).toBe(true);
    expect(u.hasRgb).toBe(false);
    expect(u.total.cmyk).toBe(6);
    expect(u.numPages).toBe(1);
  });

  it('PDF só em RGB', () => {
    const u = inspectPdfColorUsage(mupdf, load('cores-rgb.pdf'));
    expect(u.hasCmyk).toBe(false);
    expect(u.hasRgb).toBe(true);
    expect(u.total.rgb).toBe(6);
  });

  it('PDF misto: detecta os dois', () => {
    const u = inspectPdfColorUsage(mupdf, load('misto.pdf'));
    expect(u.hasCmyk && u.hasRgb).toBe(true);
    expect(u.total.cmyk).toBe(2);
    expect(u.total.rgb).toBe(2);
  });

  it('imagem CMYK conta como CMYK (Flate e JPEG)', () => {
    for (const f of ['imagem-cmyk-flate.pdf', 'imagem-cmyk-jpeg.pdf']) {
      const u = inspectPdfColorUsage(mupdf, load(f));
      expect(u.hasCmyk, f).toBe(true);
      expect(u.hasRgb, f).toBe(false);
    }
  });

  it('não invalida o buffer de quem chama', () => {
    const buf = load('cores-cmyk.pdf');
    const n = buf.length;
    inspectPdfColorUsage(mupdf, buf);
    inspectPdfColorUsage(mupdf, buf);
    expect(buf.length).toBe(n);
  });
});

describe('renderPdfPagesCmyk: os números do arquivo, sem conversão para RGB', () => {
  it('cores CMYK vetoriais saem exatamente como estão no PDF (255 = 100%)', () => {
    const { pages, numPages } = renderPdfPagesCmyk(mupdf, load('cores-cmyk.pdf'), { scale: 1 });
    expect(numPages).toBe(1);
    const p = pages[0];
    expect([p.width, p.height]).toEqual([200, 100]);
    // ciano, magenta, amarelo, preto, 40/70/0/10 e 0/50/100/0 (ver gerar-fixtures-pdf.py)
    expect(pixel(p.data, 25, 25)).toBe('255/0/0/0');
    expect(pixel(p.data, 75, 25)).toBe('0/255/0/0');
    expect(pixel(p.data, 125, 25)).toBe('0/0/255/0');
    expect(pixel(p.data, 175, 25)).toBe('0/0/0/255');
    expect(pixel(p.data, 25, 75)).toBe('102/178/0/25'); // 40/70/0/10 %
    expect(pixel(p.data, 75, 75)).toBe('0/127/255/0'); // 0/50/100/0 %
  });

  it('o papel é 0/0/0/0', () => {
    const { pages } = renderPdfPagesCmyk(mupdf, load('cores-cmyk.pdf'), { scale: 1 });
    expect(pixel(pages[0].data, 175, 75)).toBe('0/0/0/0');
  });

  it('imagens CMYK saem sem conversão, em Flate e em JPEG', () => {
    for (const f of ['imagem-cmyk-flate.pdf', 'imagem-cmyk-jpeg.pdf']) {
      const { pages } = renderPdfPagesCmyk(mupdf, load(f), { scale: 1 });
      expect(pixel(pages[0].data, 25, 25), f).toBe('255/0/0/0');
      expect(pixel(pages[0].data, 75, 25), f).toBe('0/128/255/0');
      expect(pixel(pages[0].data, 175, 75), f).toBe('0/0/0/0');
    }
  });

  it('respeita a escala e o limite de pixels', () => {
    const big = renderPdfPagesCmyk(mupdf, load('cores-cmyk.pdf'), { scale: 2 });
    expect([big.pages[0].width, big.pages[0].height]).toEqual([400, 200]);
    const capped = renderPdfPagesCmyk(mupdf, load('cores-cmyk.pdf'), { scale: 10, maxPixelsPerPage: 20000 });
    expect(capped.pages[0].width * capped.pages[0].height).toBeLessThanOrEqual(20500);
  });

  it('o ICC do MuPDF volta a ficar ligado depois da leitura', () => {
    // Estado global da biblioteca: ler um PDF não deve deixá-la alterada. Prova
    // indireta: com o ICC ligado, um PDF ICCBased não dá o valor do arquivo.
    const profilePath = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
    if (!existsSync(profilePath)) return;
    const pdf = iccBasedPdf(new Uint8Array(readFileSync(profilePath)));
    renderPdfPagesCmyk(mupdf, pdf, { scale: 1 });
    const doc = mupdf.Document.openDocument(pdf.slice(), 'application/pdf');
    const pm = doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceCMYK, false, true);
    expect(pixel(pm.getPixels(), 25, 25)).not.toBe('255/0/0/0');
  });

  it('concatCmykPages junta os pixels das páginas', () => {
    const page = (n: number) => ({ pageNumber: n, width: 1, height: 1, data: new Uint8ClampedArray([n, 0, 0, 0]) });
    expect(Array.from(concatCmykPages([page(1), page(2)]))).toEqual([1, 0, 0, 0, 2, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// PDF com perfil CMYK embutido (ICCBased): montado na hora com o .icc local,
// que não vai para o Git. Sem o arquivo, o teste é ignorado.
// ---------------------------------------------------------------------------

/** PDF mínimo de 200 x 100 pt com três retângulos em ICCBased CMYK. */
export function iccBasedPdf(profile: Uint8Array): Uint8Array {
  const content = '/CS0 cs 1 0 0 0 sc 0 50 50 50 re f 0.4 0.7 0 0.1 sc 50 50 50 50 re f 0 0 0 1 sc 100 50 50 50 re f';
  const enc = new TextEncoder();
  const parts: Uint8Array[][] = [];
  parts[1] = [enc.encode('<< /Type /Catalog /Pages 2 0 R >>')];
  parts[2] = [enc.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')];
  parts[3] = [
    enc.encode(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R ' +
        '/Resources << /ColorSpace << /CS0 [/ICCBased 5 0 R] >> >> >>',
    ),
  ];
  parts[4] = [enc.encode(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)];
  parts[5] = [
    enc.encode(`<< /N 4 /Alternate /DeviceCMYK /Length ${profile.length} >>\nstream\n`),
    profile,
    enc.encode('\nendstream'),
  ];
  const chunks: Uint8Array[] = [enc.encode('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = chunks[0].length;
  for (let i = 1; i <= 5; i++) {
    offsets[i] = length;
    for (const c of [enc.encode(`${i} 0 obj\n`), ...parts[i], enc.encode('\nendobj\n')]) {
      chunks.push(c);
      length += c.length;
    }
  }
  const xref =
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`;
  chunks.push(enc.encode(xref));
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

for (const file of ['ISOcoated_v2_eci.icc', 'PSOcoated_v3.icc']) {
  const path = resolve(process.cwd(), 'public/profiles', file);
  describe.skipIf(!existsSync(path))(`PDF com perfil embutido (${file})`, () => {
    it('com ICC ligado os valores mudariam; a leitura devolve os do arquivo', () => {
      const pdf = iccBasedPdf(new Uint8Array(readFileSync(path)));
      expect(inspectPdfColorUsage(mupdf, pdf).hasCmyk).toBe(true);
      const { pages } = renderPdfPagesCmyk(mupdf, pdf, { scale: 1 });
      expect(pixel(pages[0].data, 25, 25)).toBe('255/0/0/0');
      expect(pixel(pages[0].data, 75, 25)).toBe('102/178/0/25');
      expect(pixel(pages[0].data, 125, 25)).toBe('0/0/0/255');
    });
  });
}
