// Mensagens trocadas entre a interface e o Web Worker de análise (Fase 5).
// Tudo aqui é "clonável" (objetos simples e ArrayBuffer), sem funções.

import type { RenderingIntent } from '../icc/colorEngine';
import type { AnalysisStage, PdfAnalysis } from '../pdf/analyzePdf';
import type { FlowAReport } from '../report/flowA';

export interface AnalysisParams {
  k?: number;
  intent?: RenderingIntent;
  scale?: number;
  maxPages?: number;
  maxPixelsPerPage?: number;
}

export type WorkerRequest =
  | { id: number; type: 'loadProfile'; bytes: ArrayBuffer }
  | { id: number; type: 'analyzePdf'; file: ArrayBuffer; params: AnalysisParams }
  | { id: number; type: 'analyzeImage'; file: ArrayBuffer; mime: string; params: AnalysisParams };

export type WorkerResponse =
  | { id: number; type: 'profileLoaded'; description: string }
  | { id: number; type: 'progress'; stage: AnalysisStage }
  | { id: number; type: 'result'; analysis: PdfAnalysis; report: FlowAReport | null }
  | { id: number; type: 'error'; name: string; message: string };
