import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { createColorEngine } from '../../icc/colorEngine';
import { CmykProfileRequiredError, type AnalysisStage, type AnalyzePdfDeps } from '../../pdf/analyzePdf';
import type { RenderOptions } from '../../pdf/renderPdf';
import { createAnalysisHandler, type HandlerEnv } from '../analysisHandler';
import { AnalysisCancelledError, AnalysisClient, type WorkerLike } from '../analysisClient';
import type { WorkerRequest, WorkerResponse } from '../protocol';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
const hasProfile = existsSync(PROFILE_PATH);

const rgbDeps: AnalyzePdfDeps['rgb'] = {
  pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
  createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
};

function makeEnv(overrides: Partial<HandlerEnv['deps']> = {}): HandlerEnv {
  return {
    createEngine: () => createColorEngine(),
    deps: { rgb: rgbDeps, loadMupdf: () => import('mupdf'), ...overrides },
    rasterizeImage: async () => {
      // 4 pixels: vermelho, vermelho, azul, branco
      const data = new Uint8ClampedArray([200, 30, 30, 255, 200, 30, 30, 255, 30, 60, 200, 255, 255, 255, 255, 255]);
      return { width: 2, height: 2, data };
    },
  };
}

/** Worker de mentira: roda o handler no mesmo processo, copiando as mensagens como um Worker de verdade. */
function fakeWorker(env: HandlerEnv, log: WorkerRequest[] = []): WorkerLike & { terminated: boolean } {
  const worker: WorkerLike & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message, transfer = []) {
      const copy = structuredClone(message, { transfer }) as WorkerRequest; // transferir desanexa os buffers
      log.push(copy);
      void handle(copy);
    },
    terminate() {
      worker.terminated = true;
    },
  };
  const handle = createAnalysisHandler(env, (response: WorkerResponse) => {
    if (worker.terminated) return;
    queueMicrotask(() => {
      if (!worker.terminated) worker.onmessage?.({ data: structuredClone(response) });
    });
  });
  return worker;
}

describe('createAnalysisHandler', () => {
  it('PDF sem CMYK: devolve resultado e avisa as etapas em ordem', async () => {
    const out: WorkerResponse[] = [];
    const handle = createAnalysisHandler(makeEnv(), (r) => out.push(r));
    await handle({ id: 1, type: 'analyzePdf', file: fixture('cores-rgb.pdf').buffer as ArrayBuffer, params: { scale: 1 } });
    const stages = out.filter((r) => r.type === 'progress').map((r) => (r as { stage: AnalysisStage }).stage);
    expect(stages).toEqual(['inspecting', 'rendering', 'clustering']);
    const result = out.find((r) => r.type === 'result');
    expect(result && result.type === 'result' && result.analysis.path).toBe('rgb');
    expect(out.every((r) => r.id === 1)).toBe(true);
  });

  it('PDF com CMYK e sem perfil: erro com o nome CmykProfileRequiredError', async () => {
    const out: WorkerResponse[] = [];
    const handle = createAnalysisHandler(makeEnv(), (r) => out.push(r));
    await handle({ id: 2, type: 'analyzePdf', file: fixture('cores-cmyk.pdf').buffer as ArrayBuffer, params: { scale: 1 } });
    const err = out.find((r) => r.type === 'error');
    expect(err && err.type === 'error' && err.name).toBe('CmykProfileRequiredError');
  });

  it('perfil inválido: erro claro, e o perfil anterior (se houver) continua valendo', async () => {
    const out: WorkerResponse[] = [];
    const handle = createAnalysisHandler(makeEnv(), (r) => out.push(r));
    await handle({ id: 3, type: 'loadProfile', bytes: new Uint8Array(200).buffer });
    const err = out[0];
    expect(err.type).toBe('error');
    expect(err.type === 'error' && err.message).toMatch(/ICC|perfil/i);
  });

  it('imagem: rasteriza, agrupa e devolve no mesmo formato do PDF', async () => {
    const out: WorkerResponse[] = [];
    const handle = createAnalysisHandler(makeEnv(), (r) => out.push(r));
    await handle({ id: 4, type: 'analyzeImage', file: new ArrayBuffer(8), mime: 'image/png', params: { k: 4 } });
    const r = out.find((x) => x.type === 'result');
    expect(r && r.type === 'result').toBe(true);
    if (r && r.type === 'result') {
      expect(r.analysis.numPages).toBe(1);
      expect(r.analysis.rgb!.paperPixels).toBe(1);
      expect(r.analysis.rgb!.colors).toHaveLength(2);
    }
  });

  it('erro inesperado numa análise não derruba as seguintes', async () => {
    const out: WorkerResponse[] = [];
    const handle = createAnalysisHandler(
      makeEnv({ loadMupdf: () => Promise.reject(new Error('sem wasm')) }),
      (r) => out.push(r),
    );
    await handle({ id: 5, type: 'analyzePdf', file: new ArrayBuffer(0), params: {} }); // arquivo vazio: falha
    await handle({ id: 6, type: 'analyzePdf', file: fixture('cores-rgb.pdf').buffer as ArrayBuffer, params: { scale: 1 } });
    expect(out.some((r) => r.id === 5 && r.type === 'error')).toBe(true);
    expect(out.some((r) => r.id === 6 && r.type === 'result')).toBe(true);
  });
});

describe.skipIf(!hasProfile)('createAnalysisHandler com perfil CMYK', () => {
  it('as mensagens são processadas na ordem: loadProfile termina antes da análise seguinte', async () => {
    const out: WorkerResponse[] = [];
    const handle = createAnalysisHandler(makeEnv(), (r) => out.push(r));
    const profile = new Uint8Array(readFileSync(PROFILE_PATH)).buffer as ArrayBuffer;
    // as duas mensagens são enviadas sem esperar a primeira terminar
    const p1 = handle({ id: 1, type: 'loadProfile', bytes: profile });
    const p2 = handle({ id: 2, type: 'analyzePdf', file: fixture('cores-cmyk.pdf').buffer as ArrayBuffer, params: { scale: 1, k: 6 } });
    await Promise.all([p1, p2]);
    const result = out.find((r) => r.id === 2 && r.type === 'result');
    expect(result && result.type === 'result' && result.analysis.path).toBe('cmyk');
    expect(out.findIndex((r) => r.id === 1 && r.type === 'profileLoaded')).toBeLessThan(
      out.findIndex((r) => r.id === 2 && r.type === 'result'),
    );
  });
});

describe('AnalysisClient', () => {
  it('analisa um PDF e entrega o progresso por etapa', async () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    const stages: AnalysisStage[] = [];
    const a = await client.analyzePdf(fixture('cores-rgb.pdf'), { scale: 1, onProgress: (s) => stages.push(s) });
    expect(a.path).toBe('rgb');
    expect(a.rgb!.colors).toHaveLength(6);
    expect(a.timings.totalMs).toBeGreaterThan(0);
    expect(stages).toEqual(['inspecting', 'rendering', 'clustering']);
  });

  it('o ArrayBuffer do chamador não é desanexado (o cliente transfere uma cópia)', async () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    const bytes = fixture('cores-rgb.pdf');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await client.analyzePdf(buffer, { scale: 1 });
    expect(buffer.byteLength).toBeGreaterThan(0);
    await client.analyzePdf(buffer, { scale: 1 }); // reusa o mesmo buffer
  });

  it('o erro de perfil obrigatório chega como CmykProfileRequiredError', async () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    await expect(client.analyzePdf(fixture('cores-cmyk.pdf'), { scale: 1 })).rejects.toBeInstanceOf(
      CmykProfileRequiredError,
    );
  });

  it('analisa imagens', async () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    const a = await client.analyzeImage(new ArrayBuffer(4), 'image/png', { k: 4 });
    expect(a.rgb!.colors).toHaveLength(2);
  });

  it('um perfil inválido é recusado e não fica guardado', async () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    await expect(client.setProfile(new Uint8Array(200))).rejects.toThrow();
    expect(client.profile).toBeNull();
  });

  it('um erro do Worker (onerror) rejeita o que estava pendente e o próximo uso cria Worker novo', async () => {
    const workers: Array<ReturnType<typeof fakeWorker>> = [];
    const hangEnv = makeEnv({ loadMupdf: () => new Promise(() => {}) }); // nunca termina
    const client = new AnalysisClient(() => {
      const w = fakeWorker(hangEnv);
      workers.push(w);
      return w;
    });
    const pending = client.analyzePdf(fixture('cores-rgb.pdf'));
    workers[0].onerror?.({ message: 'quebrou' });
    await expect(pending).rejects.toThrow('quebrou');
    expect(workers[0].terminated).toBe(true);
  });
});

describe.skipIf(!hasProfile)('AnalysisClient com perfil CMYK', () => {
  const profile = () => new Uint8Array(readFileSync(PROFILE_PATH));

  it('setProfile + analisar um PDF CMYK', async () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    expect(await client.setProfile(profile())).toBe('ISO Coated v2 (ECI)');
    expect(client.profile).toBe('ISO Coated v2 (ECI)');
    const a = await client.analyzePdf(fixture('cores-cmyk.pdf'), { scale: 1, k: 6 });
    expect(a.path).toBe('cmyk');
    expect(a.cmyk!.colors).toHaveLength(6);
  });

  it('cancelar rejeita a análise, encerra o Worker e o perfil sobrevive ao próximo Worker', async () => {
    const workers: Array<ReturnType<typeof fakeWorker>> = [];
    const logs: WorkerRequest[][] = [];
    let hang = false;
    const client = new AnalysisClient(() => {
      const log: WorkerRequest[] = [];
      logs.push(log);
      const env = makeEnv({
        loadMupdf: () => (hang ? new Promise(() => {}) : import('mupdf')),
      });
      const w = fakeWorker(env, log);
      workers.push(w);
      return w;
    });

    await client.setProfile(profile());
    hang = true;
    const pending = client.analyzePdf(fixture('cores-cmyk.pdf'), { scale: 1 });
    client.cancel();
    await expect(pending).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(workers[0].terminated).toBe(true);

    // Próxima análise: Worker novo, com o perfil reenviado antes do arquivo.
    hang = false;
    const a = await client.analyzePdf(fixture('cores-cmyk.pdf'), { scale: 1, k: 6 });
    expect(a.path).toBe('cmyk');
    expect(workers).toHaveLength(2);
    expect(logs[1].map((m) => m.type)).toEqual(['loadProfile', 'analyzePdf']);
    expect(client.profile).toBe('ISO Coated v2 (ECI)');
  });

  it('cancelar sem nada em andamento não faz mal', () => {
    const client = new AnalysisClient(() => fakeWorker(makeEnv()));
    expect(() => client.cancel()).not.toThrow();
  });
});
