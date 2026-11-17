// Ponto de entrada da interface para a análise: cria o Web Worker.

import { AnalysisClient, type WorkerLike } from './analysisClient';

export function createBrowserAnalysisClient(): AnalysisClient {
  return new AnalysisClient(
    () =>
      new Worker(new URL('../../workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
      }) as unknown as WorkerLike,
  );
}
