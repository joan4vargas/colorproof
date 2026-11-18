// Cliente do Web Worker de análise: é o que a interface usa.
//
//  - `setProfile` envia o perfil ICC ao Worker (uma vez; sobrevive ao cancelamento);
//  - `analyze` envia o arquivo e devolve o resultado, com progresso por etapa;
//  - `cancel` encerra o Worker na hora (a leitura de um PDF é síncrona dentro do
//    Worker e não dá para interrompê-la de outra forma). O próximo `analyze`
//    cria um Worker novo e reenvia o perfil.
//
// O Worker é injetado por uma função, o que permite testar o cliente em Node
// com um Worker de mentira.

import type { CompareOutcome, CompareStage } from '../compare/compareFiles';
import { LayoutMismatchError } from '../compare/flowB';
import type { FlowAReport } from '../report/flowA';
import { CmykProfileRequiredError, type AnalysisStage, type PdfAnalysis } from '../pdf/analyzePdf';
import type { PrintSimulation, SimulateStage } from '../simulate/simulatePrint';
import type { SpotColor } from '../pdf/spotColors';
import type { SpotInput, SpotMatch } from '../spot/spotMatch';
import type { RenderingIntent } from '../icc/colorEngine';
import type { AnalysisParams, CompareParams, SimulateParams, WorkerRequest, WorkerResponse } from './protocol';

export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** A análise e, quando há perfil carregado, o laudo do Fluxo A (senão `null`). */
export type AnalysisOutcome = PdfAnalysis & { report: FlowAReport | null };

export class AnalysisCancelledError extends Error {
  constructor() {
    super('Análise cancelada.');
    this.name = 'AnalysisCancelledError';
  }
}

export interface AnalyzeOptions extends AnalysisParams {
  onProgress?: (stage: AnalysisStage) => void;
}

export interface CompareOptions extends CompareParams {
  onProgress?: (stage: CompareStage) => void;
}

export interface SimulateOptions extends SimulateParams {
  onProgress?: (stage: SimulateStage) => void;
}

type AnyStage = AnalysisStage | CompareStage | SimulateStage;
type ProgressFn = (stage: AnyStage) => void;

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: ProgressFn;
}

const toArrayBuffer = (data: ArrayBuffer | Uint8Array): ArrayBuffer =>
  data instanceof Uint8Array
    ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    : data.slice(0);

export class AnalysisClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private profileBytes: ArrayBuffer | null = null;
  private profileDescription: string | null = null;

  private readonly createWorker: () => WorkerLike;

  constructor(createWorker: () => WorkerLike) {
    this.createWorker = createWorker;
  }

  /** Descrição do perfil carregado, ou null. */
  get profile(): string | null {
    return this.profileDescription;
  }

  /** Envia o perfil ICC (CMYK) ao Worker. Devolve a descrição do perfil. */
  async setProfile(bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const copy = toArrayBuffer(bytes);
    const description = await this.request<string>(
      (id) => ({ id, type: 'loadProfile', bytes: copy.slice(0) }),
      [],
    );
    this.profileBytes = copy; // só guarda depois de o Worker aceitar o perfil
    this.profileDescription = description;
    return description;
  }

  /** Analisa um PDF. */
  analyzePdf(file: ArrayBuffer | Uint8Array, options: AnalyzeOptions = {}): Promise<AnalysisOutcome> {
    const { onProgress, ...params } = options;
    const buffer = toArrayBuffer(file);
    return this.request<AnalysisOutcome>(
      (id) => ({ id, type: 'analyzePdf', file: buffer, params }),
      [buffer],
      onProgress as ProgressFn | undefined,
    );
  }

  /** Fluxo B: compara a referência com a simulação (PDF ou imagem; mesmo layout). */
  compare(
    reference: { file: ArrayBuffer | Uint8Array; mime: string },
    simulation: { file: ArrayBuffer | Uint8Array; mime: string },
    options: CompareOptions = {},
  ): Promise<CompareOutcome> {
    const { onProgress, ...params } = options;
    const ref = { file: toArrayBuffer(reference.file), mime: reference.mime };
    const sim = { file: toArrayBuffer(simulation.file), mime: simulation.mime };
    return this.request<CompareOutcome>(
      (id) => ({ id, type: 'compare', reference: ref, simulation: sim, params }),
      [ref.file, sim.file],
      onProgress as ProgressFn | undefined,
    );
  }

  /** Lista as cores spot (Pantone etc.) de um PDF. Não precisa de perfil. */
  listSpots(file: ArrayBuffer | Uint8Array): Promise<SpotColor[]> {
    const buffer = toArrayBuffer(file);
    return this.request<SpotColor[]>((id) => ({ id, type: 'spotList', file: buffer }), [buffer]);
  }

  /** Melhor CMYK de cada cor spot, pelo perfil carregado. */
  matchSpots(items: SpotInput[], intent?: RenderingIntent): Promise<{ matches: SpotMatch[]; profileDescription: string }> {
    return this.request<{ matches: SpotMatch[]; profileDescription: string }>((id) => ({ id, type: 'spotMatch', items, intent }), []);
  }

  /** Simula a impressão de um arquivo (PDF ou imagem) pelo perfil carregado. */
  simulate(file: ArrayBuffer | Uint8Array, mime: string, options: SimulateOptions = {}): Promise<PrintSimulation> {
    const { onProgress, ...params } = options;
    const buffer = toArrayBuffer(file);
    return this.request<PrintSimulation>(
      (id) => ({ id, type: 'simulate', input: { file: buffer, mime }, params }),
      [buffer],
      onProgress as ProgressFn | undefined,
    );
  }

  /** Analisa uma imagem (PNG, JPEG...). */
  analyzeImage(file: ArrayBuffer | Uint8Array, mime: string, options: AnalyzeOptions = {}): Promise<AnalysisOutcome> {
    const { onProgress, ...params } = options;
    const buffer = toArrayBuffer(file);
    return this.request<AnalysisOutcome>(
      (id) => ({ id, type: 'analyzeImage', file: buffer, mime, params }),
      [buffer],
      onProgress as ProgressFn | undefined,
    );
  }

  /** Cancela o que estiver em andamento encerrando o Worker. O perfil é mantido. */
  cancel(): void {
    this.dropWorker(new AnalysisCancelledError());
  }

  dispose(): void {
    this.cancel();
    this.profileBytes = null;
    this.profileDescription = null;
  }

  // --- internos -----------------------------------------------------------

  private dropWorker(reason: Error): void {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(reason);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event) => this.onMessage(event.data);
    worker.onerror = (event) => {
      if (this.worker === worker) this.dropWorker(new Error(event.message || 'O Worker de análise falhou.'));
    };
    this.worker = worker;
    // Worker novo (primeiro uso ou depois de cancelar): reenvia o perfil, na frente de tudo.
    if (this.profileBytes) {
      const id = this.nextId++;
      this.pending.set(id, { resolve: () => {}, reject: () => {} });
      const bytes = this.profileBytes.slice(0);
      worker.postMessage({ id, type: 'loadProfile', bytes }, [bytes]);
    }
    return worker;
  }

  private onMessage(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === 'progress') {
      pending.onProgress?.(response.stage);
      return;
    }
    this.pending.delete(response.id);
    if (response.type === 'error') {
      pending.reject(
        response.name === 'CmykProfileRequiredError'
          ? new CmykProfileRequiredError()
          : Object.assign(
              response.name === 'LayoutMismatchError' ? Object.create(LayoutMismatchError.prototype) : new Error(),
              { message: response.message, name: response.name },
            ),
      );
      return;
    }
    (pending.resolve as (v: unknown) => void)(
      response.type === 'result'
        ? { ...response.analysis, report: response.report }
        : response.type === 'compareResult'
          ? response.outcome
          : response.type === 'simulateResult'
            ? response.simulation
            : response.type === 'spotListResult'
              ? response.spots
              : response.type === 'spotMatchResult'
                ? { matches: response.matches, profileDescription: response.profileDescription }
                : response.description,
    );
  }

  private request<T>(
    build: (id: number) => WorkerRequest,
    transfer: Transferable[],
    onProgress?: ProgressFn,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: never) => void,
        reject,
        onProgress,
      });
      worker.postMessage(build(id), transfer);
    });
  }
}
