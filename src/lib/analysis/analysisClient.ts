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

import { CmykProfileRequiredError, type AnalysisStage, type PdfAnalysis } from '../pdf/analyzePdf';
import type { AnalysisParams, WorkerRequest, WorkerResponse } from './protocol';

export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export class AnalysisCancelledError extends Error {
  constructor() {
    super('Análise cancelada.');
    this.name = 'AnalysisCancelledError';
  }
}

export interface AnalyzeOptions extends AnalysisParams {
  onProgress?: (stage: AnalysisStage) => void;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: (stage: AnalysisStage) => void;
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
  analyzePdf(file: ArrayBuffer | Uint8Array, options: AnalyzeOptions = {}): Promise<PdfAnalysis> {
    const { onProgress, ...params } = options;
    const buffer = toArrayBuffer(file);
    return this.request<PdfAnalysis>(
      (id) => ({ id, type: 'analyzePdf', file: buffer, params }),
      [buffer],
      onProgress,
    );
  }

  /** Analisa uma imagem (PNG, JPEG...). */
  analyzeImage(file: ArrayBuffer | Uint8Array, mime: string, options: AnalyzeOptions = {}): Promise<PdfAnalysis> {
    const { onProgress, ...params } = options;
    const buffer = toArrayBuffer(file);
    return this.request<PdfAnalysis>(
      (id) => ({ id, type: 'analyzeImage', file: buffer, mime, params }),
      [buffer],
      onProgress,
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
          : Object.assign(new Error(response.message), { name: response.name }),
      );
      return;
    }
    (pending.resolve as (v: unknown) => void)(
      response.type === 'result' ? response.analysis : response.description,
    );
  }

  private request<T>(
    build: (id: number) => WorkerRequest,
    transfer: Transferable[],
    onProgress?: (stage: AnalysisStage) => void,
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
