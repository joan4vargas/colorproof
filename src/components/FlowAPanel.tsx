// Fluxo A na interface: um arquivo contra a condição de impressão.

import { useEffect, useRef, useState } from 'react';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { AnalysisCancelledError, type AnalysisClient, type AnalysisOutcome } from '../lib/analysis/analysisClient';
import { downloadText, printHtml, reportFileName } from '../lib/browser/download';
import { CmykProfileRequiredError, type AnalysisStage } from '../lib/pdf/analyzePdf';
import { flowAToCsv, flowAToHtml } from '../lib/report/export';
import { FilePick, Status, VerdictBadge } from './common';
import { fmtCmyk, fmtLab, isPdf, mimeOf, pct } from './format';

const STAGE_LABEL: Record<AnalysisStage, string> = {
  inspecting: 'Inspecionando os espaços de cor…',
  rendering: 'Lendo as páginas…',
  clustering: 'Agrupando as cores…',
};

interface Props {
  getClient: () => AnalysisClient;
  /** Registra uma função que o App chama quando um perfil novo é carregado (reanálise). */
  registerRerun: (fn: () => void) => () => void;
  hasProfile: boolean;
}

export default function FlowAPanel({ getClient, registerRerun, hasProfile }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<AnalysisOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<AnalysisStage | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<File | null>(null);

  async function run(f: File) {
    setOutcome(null);
    setError(null);
    setBusy(true);
    setStage(null);
    try {
      const data = await f.arrayBuffer();
      const options = { k: 8, onProgress: setStage };
      setOutcome(
        isPdf(f)
          ? await getClient().analyzePdf(data, options)
          : await getClient().analyzeImage(data, mimeOf(f), options),
      );
    } catch (e) {
      if (e instanceof AnalysisCancelledError) setError('Análise cancelada.');
      else if (e instanceof CmykProfileRequiredError) setError(`${e.message} Escolha o perfil acima e o arquivo será analisado.`);
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
  useEffect(
    () =>
      registerRerun(() => {
        if (fileRef.current) void runRef.current(fileRef.current);
      }),
    [registerRerun],
  );

  const report = outcome?.report ?? null;
  const exportData = outcome && report && file ? { fileName: file.name, analysis: outcome, report } : null;
  const meta = () => ({ generatedAt: new Date(), appName: 'ColorProof' });

  return (
    <div>
      <section className="card">
        <h2>Verificar um arquivo</h2>
        <p className="muted">
          Para cada cor dominante, o sistema simula a ida e a volta pela condição de impressão do perfil e mede a diferença
          em ΔE00. PDFs com CMYK exigem o perfil.
        </p>
        <FilePick
          label="PDF ou imagem"
          buttonText="Escolher arquivo"
          accept=".pdf,application/pdf,image/*"
          fileName={file?.name}
          onFile={(f) => {
            fileRef.current = f;
            setFile(f);
            void run(f);
          }}
        />
        {!hasProfile && <Status kind="info">Sem perfil carregado, o veredito não é calculado. Escolha o perfil acima.</Status>}
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

      {outcome && file && (
        <section className="card" aria-live="polite">
          <h2>Resultado</h2>
          <p className="muted">
            {file.name} · {outcome.analyzedPages < outcome.numPages ? `${outcome.analyzedPages} de ${outcome.numPages} páginas` : `${outcome.numPages} página(s)`} ·{' '}
            {outcome.path === 'cmyk' ? 'CMYK lido do arquivo' : 'sRGB'} · {outcome.timings.totalMs.toFixed(0)} ms
          </p>
          {report ? (
            <>
              <p>
                Resultado geral: <VerdictBadge verdict={report.verdict} big /> · perfil {report.profileDescription} · limites ΔE00:
                aprovado até {report.thresholds.approvedMax.toFixed(1)}, atenção até {report.thresholds.attentionMax.toFixed(1)},
                reprovado acima.
              </p>
              {report.warnings.map((w, i) => (
                <Status key={i} kind="warn">
                  {w}
                </Status>
              ))}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cor</th>
                      <th>Origem</th>
                      <th>Participação</th>
                      <th>Lab de origem</th>
                      <th>CMYK reproduzido (%)</th>
                      <th>ΔE00</th>
                      <th>Veredito</th>
                      {report.path === 'cmyk' && <th>ΔE00 na tela (informativo)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {report.findings.map((f, i) => {
                      const sw = f.source.kind === 'rgb' ? f.source.rgb : labD50ToRgbClipped(f.labSource);
                      return (
                        <tr key={i}>
                          <td>
                            <span className="sw" style={{ background: `rgb(${sw.r}, ${sw.g}, ${sw.b})` }} />
                          </td>
                          <td>{f.source.kind === 'rgb' ? `sRGB ${f.source.rgb.r}, ${f.source.rgb.g}, ${f.source.rgb.b}` : `CMYK ${fmtCmyk(f.source.cmyk)}`}</td>
                          <td>{pct(f.pixelShare)}</td>
                          <td>{fmtLab(f.labSource)}</td>
                          <td>{fmtCmyk(f.cmykReproduced)}</td>
                          <td>{f.deltaE.toFixed(2)}</td>
                          <td>
                            <VerdictBadge verdict={f.verdict} />
                          </td>
                          {report.path === 'cmyk' && <td>{f.screenDeltaE?.toFixed(2)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {exportData && (
                <div className="actions">
                  <button type="button" className="secondary" onClick={() => printHtml(flowAToHtml(exportData, meta()))}>
                    Imprimir ou salvar em PDF
                  </button>
                  <button type="button" className="secondary" onClick={() => downloadText(reportFileName(file.name, 'html'), flowAToHtml(exportData, meta()), 'text/html')}>
                    Baixar laudo (HTML)
                  </button>
                  <button type="button" className="secondary" onClick={() => downloadText(reportFileName(file.name, 'csv'), flowAToCsv(exportData), 'text/csv')}>
                    Baixar tabela (CSV)
                  </button>
                </div>
              )}
            </>
          ) : (
            <Status kind="info">Análise concluída, mas sem perfil não há veredito. Escolha o perfil CMYK de saída acima.</Status>
          )}
          <p className="limits">
            Simulação numérica pelo perfil ICC, não laudo de conformidade ISO 12647 (a norma exige medição do impresso com
            espectrofotômetro). Os limites de ΔE00 são decisão de projeto.
          </p>
        </section>
      )}
    </div>
  );
}
