// Fluxo B na interface: referência contra simulação do mesmo layout.

import { useEffect, useRef, useState } from 'react';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { AnalysisCancelledError, type AnalysisClient } from '../lib/analysis/analysisClient';
import { downloadText, printHtml, reportFileName } from '../lib/browser/download';
import type { CompareOutcome, CompareStage } from '../lib/compare/compareFiles';
import { CmykProfileRequiredError } from '../lib/pdf/analyzePdf';
import { flowBToCsv, flowBToHtml } from '../lib/report/export';
import { FilePick, Status, VerdictBadge } from './common';
import { fmtLab, mimeOf, pct } from './format';

const STAGE_LABEL: Record<CompareStage, string> = {
  reference: 'Lendo a referência…',
  simulation: 'Lendo a simulação…',
  comparing: 'Comparando as regiões…',
};

interface Props {
  getClient: () => AnalysisClient;
  registerRerun: (fn: () => void) => () => void;
  profileName: string | null;
}

export default function FlowBPanel({ getClient, registerRerun, profileName }: Props) {
  const [reference, setReference] = useState<File | null>(null);
  const [simulation, setSimulation] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<CompareOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<CompareStage | null>(null);
  const [busy, setBusy] = useState(false);
  const files = useRef<{ ref: File | null; sim: File | null }>({ ref: null, sim: null });

  async function run() {
    const { ref, sim } = files.current;
    setOutcome(null);
    setError(null);
    if (!ref || !sim) return;
    setBusy(true);
    setStage(null);
    try {
      const [a, b] = await Promise.all([ref.arrayBuffer(), sim.arrayBuffer()]);
      setOutcome(await getClient().compare({ file: a, mime: mimeOf(ref) }, { file: b, mime: mimeOf(sim) }, { onProgress: setStage }));
    } catch (e) {
      if (e instanceof AnalysisCancelledError) setError('Comparação cancelada.');
      else if (e instanceof CmykProfileRequiredError) setError(`${e.message} Escolha o perfil acima e a comparação será refeita.`);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => registerRerun(() => void runRef.current()), [registerRerun]);

  const meta = () => ({ generatedAt: new Date(), appName: 'ColorProof' });
  const exportData =
    outcome && reference && simulation
      ? { referenceName: reference.name, simulationName: simulation.name, profileDescription: profileName, outcome }
      : null;
  const baseName = reference && simulation ? `${reference.name}-x-${simulation.name}` : 'comparacao';

  return (
    <div>
      <section className="card">
        <h2>Comparar duas versões do mesmo layout</h2>
        <p className="muted">
          A referência (por exemplo, a arte aprovada em RGB) e a simulação (por exemplo, a versão em CMYK) são divididas em
          regiões, e a cor mais frequente de cada região é comparada em ΔE00. As duas precisam ter o mesmo layout.
        </p>
        <FilePick
          label="Referência"
          buttonText="Escolher referência"
          accept=".pdf,application/pdf,image/*"
          fileName={reference?.name}
          onFile={(f) => {
            files.current.ref = f;
            setReference(f);
            void run();
          }}
        />
        <FilePick
          label="Simulação"
          buttonText="Escolher simulação"
          accept=".pdf,application/pdf,image/*"
          fileName={simulation?.name}
          onFile={(f) => {
            files.current.sim = f;
            setSimulation(f);
            void run();
          }}
        />
        {busy && (
          <Status kind="info">
            {stage ? STAGE_LABEL[stage] : 'Enviando ao Worker…'}{' '}
            <button type="button" className="secondary" onClick={() => getClient().cancel()}>
              Cancelar
            </button>
          </Status>
        )}
        {error && <Status kind="error">Erro: {error}</Status>}
      </section>

      {outcome && (
        <section className="card" aria-live="polite">
          <h2>Resultado</h2>
          <p>
            Resultado geral: <VerdictBadge verdict={outcome.report.verdict} big /> · pelo percentil 95 do ΔE00 das regiões ·
            referência {outcome.reference.path === 'cmyk' ? 'CMYK' : 'sRGB'}, simulação {outcome.simulation.path === 'cmyk' ? 'CMYK' : 'sRGB'} · grade{' '}
            {outcome.report.grid} × {outcome.report.grid} · {outcome.totalMs.toFixed(0)} ms
          </p>
          {outcome.report.warnings.map((w, i) => (
            <Status key={i} kind="warn">
              {w}
            </Status>
          ))}
          {outcome.report.pages.map((p) => (
            <div key={p.pageNumber}>
              <h3>Página {p.pageNumber}</h3>
              <p>
                {p.compared} regiões comparadas · ΔE00 médio {p.meanDeltaE.toFixed(2)} · p95 {p.p95DeltaE.toFixed(2)} · máximo{' '}
                {p.maxDeltaE.toFixed(2)} (pior caso: <VerdictBadge verdict={p.worstCaseVerdict} />)
              </p>
              <p>
                Regiões aprovadas {pct(p.shares.aprovado)} · atenção {pct(p.shares.atencao)} · reprovadas {pct(p.shares.reprovado)} ·
                resultado da página: <VerdictBadge verdict={p.verdict} />
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Região (linha, coluna)</th>
                      <th>ΔE00</th>
                      <th>Lab referência</th>
                      <th>Lab simulação</th>
                      <th>Região uniforme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.worst.map((w, i) => {
                      const a = labD50ToRgbClipped(w.reference);
                      const b = labD50ToRgbClipped(w.simulation);
                      return (
                        <tr key={i}>
                          <td>
                            {w.row + 1}, {w.col + 1}
                          </td>
                          <td>{w.deltaE.toFixed(2)}</td>
                          <td>
                            <span className="sw" style={{ background: `rgb(${a.r}, ${a.g}, ${a.b})` }} />
                            {fmtLab(w.reference)}
                          </td>
                          <td>
                            <span className="sw" style={{ background: `rgb(${b.r}, ${b.g}, ${b.b})` }} />
                            {fmtLab(w.simulation)}
                          </td>
                          <td>{pct(w.minShare)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {exportData && (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => printHtml(flowBToHtml(exportData, meta()))}>
                Imprimir ou salvar em PDF
              </button>
              <button type="button" className="secondary" onClick={() => downloadText(reportFileName(baseName, 'html'), flowBToHtml(exportData, meta()), 'text/html')}>
                Baixar laudo (HTML)
              </button>
              <button type="button" className="secondary" onClick={() => downloadText(reportFileName(baseName, 'csv'), flowBToCsv(exportData), 'text/csv')}>
                Baixar tabela (CSV)
              </button>
            </div>
          )}
          <p className="limits">
            Simulação numérica por região, não laudo ISO 12647. Elementos menores que uma região podem não aparecer, e bordas
            geram regiões mistas.
          </p>
        </section>
      )}
    </div>
  );
}
