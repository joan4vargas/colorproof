import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { simulatePrint, type SimulateDeps } from '../../simulate/simulatePrint';
import { analyzePdf } from '../analyzePdf';
import { renderPdfPagesCmyk } from '../cmykPdf';
import { renderPdfPages, type RenderOptions } from '../renderPdf';

/** PDF de várias páginas; cada página é preenchida por inteiro com a cor dada (operador de cor + "re f"). */
function multiPagePdf(fills: string[]): Uint8Array {
  const objs: string[] = [];
  const n = fills.length;
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${fills.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`);
  fills.forEach((fill, i) => {
    const stream = `${fill} 0 0 200 200 re f`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${4 + i * 2} 0 R /Resources << >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const rgbDeps: Pick<RenderOptions, 'pdfjs' | 'createCanvas'> = {
  pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
  createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
};
const RED = '1 0 0 rg';
const GREEN = '0 1 0 rg';
const BLUE = '0 0 1 rg';
const center = (p: { width: number; height: number; data: Uint8ClampedArray }) => {
  const i = (Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
};

describe('escolha da página a renderizar', () => {
  const pdf = multiPagePdf([RED, GREEN, BLUE]);

  it('RGB: firstPage = 3 renderiza só a terceira página e informa o total', async () => {
    const r = await renderPdfPages(pdf, { ...rgbDeps, scale: 1, maxPages: 1, firstPage: 3 });
    expect(r.numPages).toBe(3);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].pageNumber).toBe(3);
    expect(center(r.pages[0])).toEqual([0, 0, 255]);
  });

  it('RGB: página fora do intervalo é limitada à última', async () => {
    const r = await renderPdfPages(pdf, { ...rgbDeps, scale: 1, maxPages: 1, firstPage: 99 });
    expect(r.pages[0].pageNumber).toBe(3);
  });

  it('CMYK: firstPage = 2 renderiza só a segunda página', async () => {
    const mupdf = await import('mupdf');
    const cmykPdf = multiPagePdf(['1 0 0 0 k', '0 1 0 0 k', '0 0 1 0 k']);
    const r = renderPdfPagesCmyk(mupdf, cmykPdf, { scale: 1, maxPages: 1, firstPage: 2 });
    expect(r.numPages).toBe(3);
    expect(r.pages[0].pageNumber).toBe(2);
    const i = (Math.floor(r.pages[0].height / 2) * r.pages[0].width + Math.floor(r.pages[0].width / 2)) * 4;
    expect([...r.pages[0].data.slice(i, i + 4)]).toEqual([0, 255, 0, 0]);
  });
});

const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
describe.skipIf(!existsSync(PROFILE_PATH))('simulação de uma página escolhida', () => {
  let engine: ColorEngine;
  let profile: IccProfileHandle;
  beforeAll(async () => {
    engine = await createColorEngine();
    profile = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)));
  });
  afterAll(() => {
    profile?.libera();
    engine?.dispose();
  });
  const deps: SimulateDeps = {
    rgb: rgbDeps,
    loadMupdf: () => import('mupdf'),
    rasterizeImage: async () => {
      throw new Error('não usado');
    },
  };

  it('page = 2 mostra a segunda página e o laudo leva o número dela', async () => {
    const pdf = multiPagePdf([RED, GREEN, BLUE]);
    const sim = await simulatePrint({ file: pdf, mime: 'application/pdf' }, deps, { profile, scale: 1, page: 2 });
    expect(sim.numPages).toBe(3);
    expect(sim.page).toBe(2);
    expect(sim.report?.pages[0].pageNumber).toBe(2);
    expect(sim.warnings.join(' ')).not.toMatch(/só a primeira/);
  });

  it('sem page, mostra a primeira', async () => {
    const pdf = multiPagePdf([RED, GREEN]);
    const sim = await simulatePrint({ file: pdf, mime: 'application/pdf' }, deps, { profile, scale: 1 });
    expect(sim.page).toBe(1);
  });
});

describe('análise de PDF com muitas páginas', () => {
  const analyzeDeps = { rgb: rgbDeps, loadMupdf: () => import('mupdf') };
  const many = (n: number) => multiPagePdf(Array.from({ length: n }, (_, i) => (i % 2 ? RED : BLUE)));

  it('28 páginas: todas são lidas, sem aviso de corte', async () => {
    const a = await analyzePdf(many(28), analyzeDeps, { scale: 0.5 });
    expect(a.numPages).toBe(28);
    expect(a.analyzedPages).toBe(28);
    expect(a.warnings.join(' ')).not.toMatch(/primeiras/);
  });

  it('acima do limite de 30 páginas, avisa quantas foram lidas', async () => {
    const a = await analyzePdf(many(32), analyzeDeps, { scale: 0.5 });
    expect(a.analyzedPages).toBe(30);
    expect(a.warnings.join(' ')).toMatch(/30 primeiras das 32 páginas/);
  });
});
