// Lógica do Web Worker de análise, separada do Worker em si para poder ser
// testada em Node. O arquivo do Worker (`src/workers/analysis.worker.ts`) só
// liga esta lógica ao navegador.
//
// As mensagens são processadas uma de cada vez, na ordem em que chegam: assim
// um `loadProfile` sempre termina antes da análise que veio depois dele.

import { extractDominantColors } from '../sampling/dominantColors';
import type { ColorEngine, IccProfileHandle } from '../icc/colorEngine';
import { evaluateFlowA } from '../report/flowA';
import { analyzePdf, type AnalyzePdfDeps, type PdfAnalysis } from '../pdf/analyzePdf';
import type { AnalysisParams, WorkerRequest, WorkerResponse } from './protocol';

export interface HandlerEnv {
  createEngine: () => Promise<ColorEngine>;
  deps: AnalyzePdfDeps;
  rasterizeImage: (
    bytes: ArrayBuffer,
    mime: string,
    maxPixels?: number,
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createAnalysisHandler(
  env: HandlerEnv,
  post: (response: WorkerResponse) => void,
): (request: WorkerRequest) => Promise<void> {
  let engine: ColorEngine | null = null;
  let profile: IccProfileHandle | null = null;
  let chain: Promise<void> = Promise.resolve();

  async function run(req: WorkerRequest): Promise<void> {
    const { id } = req;
    try {
      if (req.type === 'loadProfile') {
        engine ??= await env.createEngine();
        const loaded = await engine.loadProfile(new Uint8Array(req.bytes));
        profile?.libera();
        profile = loaded;
        post({ id, type: 'profileLoaded', description: loaded.description });
        return;
      }

      const params: AnalysisParams = req.params;
      const onProgress = (stage: 'inspecting' | 'rendering' | 'clustering') =>
        post({ id, type: 'progress', stage });

      let analysis: PdfAnalysis;
      if (req.type === 'analyzePdf') {
        analysis = await analyzePdf(req.file, env.deps, {
          ...params,
          profile: profile ?? undefined,
          onProgress,
        });
      } else {
        const t0 = now();
        onProgress('rendering');
        const img = await env.rasterizeImage(req.file, req.mime);
        const t1 = now();
        onProgress('clustering');
        const rgb = extractDominantColors(img.data, { k: params.k });
        const t2 = now();
        analysis = {
          path: 'rgb',
          numPages: 1,
          analyzedPages: 1,
          usage: null,
          warnings: [],
          timings: { inspectMs: 0, renderMs: t1 - t0, clusterMs: t2 - t1, totalMs: t2 - t0 },
          rgb,
        };
      }
      // Fluxo A: com perfil carregado, já devolve o laudo (o round-trip roda aqui, fora da tela).
      const report = profile ? evaluateFlowA(analysis, profile) : null;
      post({ id, type: 'result', analysis, report });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      post({ id, type: 'error', name: err.name, message: err.message });
    }
  }

  return (request) => {
    chain = chain.then(() => run(request));
    return chain;
  };
}
