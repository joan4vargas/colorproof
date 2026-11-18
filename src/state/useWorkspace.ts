// Estado compartilhado do app: o arquivo, o perfil e os resultados que as
// quatro páginas mostram. Um arquivo enviado dispara duas coisas no Worker,
// uma depois da outra: a análise das cores (amostras) e a simulação de impressão.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isPdf, mimeOf } from '../components/format';
import { AnalysisCancelledError, type AnalysisClient, type AnalysisOutcome } from '../lib/analysis/analysisClient';
import { createBrowserAnalysisClient } from '../lib/analysis/browserAnalysis';
import { CmykProfileRequiredError, type AnalysisStage } from '../lib/pdf/analyzePdf';
import type { RenderingIntent } from '../lib/icc/colorEngine';
import type { SpotColor } from '../lib/pdf/spotColors';
import type { PrintSimulation, SimulateStage } from '../lib/simulate/simulatePrint';
import type { SpotInput, SpotMatch } from '../lib/spot/spotMatch';

export type Stage = AnalysisStage | SimulateStage;

export const STAGE_LABEL: Record<Stage, string> = {
  inspecting: 'Inspecionando os espaços de cor…',
  rendering: 'Lendo as páginas…',
  clustering: 'Agrupando as cores…',
  reading: 'Lendo o arquivo…',
  simulating: 'Simulando a impressão…',
  comparing: 'Comparando as regiões…',
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Workspace {
  file: File | null;
  profileName: string | null;
  profileError: string | null;
  analysis: AnalysisOutcome | null;
  simulation: PrintSimulation | null;
  busy: boolean;
  stage: Stage | null;
  error: string | null;
  simulationError: string | null;
  pickFile: (f: File) => void;
  pickProfile: (f: File) => Promise<void>;
  cancel: () => void;
  /** Cores spot do PDF aberto. */
  listSpots: () => Promise<SpotColor[]>;
  /** Cores spot do PDF escolhido (lidas em segundo plano); null enquanto não se sabe. */
  fileSpots: SpotColor[] | null;
  /** Melhor CMYK de cada cor spot, pelo perfil carregado. */
  matchSpots: (items: SpotInput[], intent: RenderingIntent) => Promise<{ matches: SpotMatch[]; profileDescription: string }>;
}

export function useWorkspace(): Workspace {
  const clientRef = useRef<AnalysisClient | null>(null);
  const fileRef = useRef<File | null>(null);
  const spotsFor = useRef<File | null>(null);
  const [fileSpots, setFileSpots] = useState<SpotColor[] | null>(null);
  const runId = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisOutcome | null>(null);
  const [simulation, setSimulation] = useState<PrintSimulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const getClient = useCallback(() => (clientRef.current ??= createBrowserAnalysisClient()), []);
  useEffect(() => () => clientRef.current?.dispose(), []);

  const run = useCallback(
    async (f: File) => {
      const id = ++runId.current;
      const client = getClient();
      setBusy(true);
      setStage(null);
      setError(null);
      setSimulationError(null);
      setAnalysis(null);
      setSimulation(null);
      try {
        const data = await f.arrayBuffer();
        const mime = mimeOf(f);
        try {
          const options = { k: 8, onProgress: setStage };
          const result = isPdf(f)
            ? await client.analyzePdf(data.slice(0), options)
            : await client.analyzeImage(data.slice(0), mime, options);
          if (id !== runId.current) return;
          setAnalysis(result);
        } catch (e) {
          if (id !== runId.current || e instanceof AnalysisCancelledError) return;
          setError(
            e instanceof CmykProfileRequiredError
              ? `${e.message} Escolha o perfil de impressão no alto da página e o arquivo será analisado.`
              : messageOf(e),
          );
          return;
        }
        if (!client.profile) return;
        try {
          const result = await client.simulate(data.slice(0), mime, { onProgress: setStage });
          if (id !== runId.current) return;
          setSimulation(result);
        } catch (e) {
          if (id !== runId.current || e instanceof AnalysisCancelledError) return;
          setSimulationError(messageOf(e));
        }
      } finally {
        if (id === runId.current) {
          setBusy(false);
          setStage(null);
        }
      }
    },
    [getClient],
  );

  const pickFile = useCallback(
    (f: File) => {
      fileRef.current = f;
      setFile(f);
      setFileSpots(null);
      void run(f);
    },
    [run],
  );

  const pickProfile = useCallback(
    async (f: File) => {
      setProfileError(null);
      try {
        setProfileName(await getClient().setProfile(await f.arrayBuffer()));
        if (fileRef.current) void run(fileRef.current); // refaz tudo com a condição de impressão nova
      } catch (e) {
        setProfileError(messageOf(e));
      }
    },
    [getClient, run],
  );

  const cancel = useCallback(() => {
    runId.current++;
    clientRef.current?.cancel();
    setBusy(false);
    setStage(null);
    setError('Análise cancelada.');
  }, []);

  const listSpots = useCallback(async () => {
    const f = fileRef.current;
    if (!f) throw new Error('Envie um PDF primeiro.');
    return getClient().listSpots(await f.arrayBuffer());
  }, [getClient]);

  const matchSpots = useCallback((items: SpotInput[], intent: RenderingIntent) => getClient().matchSpots(items, intent), [getClient]);

  // Depois que a análise termina, descobre em segundo plano se o PDF usa cores spot (Pantone etc.).
  useEffect(() => {
    if (!file || busy || spotsFor.current === file) return;
    if (!isPdf(file)) return;
    spotsFor.current = file;
    listSpots()
      .then((s) => spotsFor.current === file && setFileSpots(s))
      .catch(() => spotsFor.current === file && setFileSpots([]));
  }, [file, busy, listSpots]);

  return { file, fileSpots, profileName, profileError, analysis, simulation, busy, stage, error, simulationError, pickFile, pickProfile, cancel, listSpots, matchSpots };
}
