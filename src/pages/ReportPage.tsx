// Relatório: laudos exportáveis e o texto do método.

import AboutPanel from '../components/AboutPanel';
import { Card, Icon } from '../components/ui';
import { downloadText, printHtml, reportFileName } from '../lib/browser/download';
import type { CompareOutcome } from '../lib/compare/compareFiles';
import { flowAToCsv, flowAToHtml, flowBToCsv, flowBToHtml } from '../lib/report/export';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, Progress } from './common';

export default function ReportPage({ ws }: { ws: Workspace }) {
  const { file, analysis, simulation } = ws;
  const meta = () => ({ generatedAt: new Date(), appName: 'ColorProof' });

  const samples = file && analysis?.report ? { fileName: file.name, analysis, report: analysis.report } : null;
  const sim = file && simulation?.report
    ? {
        referenceName: `${file.name} (original)`,
        simulationName: `${file.name} (simulação de impressão)`,
        profileDescription: analysis?.report?.profileDescription ?? null,
        outcome: {
          report: simulation.report,
          reference: { path: 'rgb' as const, numPages: simulation.numPages, pages: 1 },
          simulation: { path: 'rgb' as const, numPages: simulation.numPages, pages: 1 },
          intent: simulation.intent,
          totalMs: simulation.totalMs,
        } satisfies CompareOutcome,
      }
    : null;

  return (
    <div className="stack">
      {!file && <EmptyFile ws={ws} />}
      {file && <Progress ws={ws} />}
      {file && (
        <div className="grid g-1-1">
          <Card title="Laudo das amostras" subtitle="Cada cor dominante contra a condição de impressão, com o resultado geral.">
            {samples ? (
              <div className="actions">
                <button type="button" className="btn primary" onClick={() => printHtml(flowAToHtml(samples, meta()))}>
                  <Icon name="print" size={18} /> Imprimir ou salvar em PDF
                </button>
                <button type="button" className="btn" onClick={() => downloadText(reportFileName(file.name, 'html'), flowAToHtml(samples, meta()), 'text/html')}>
                  <Icon name="download" size={18} /> Laudo (HTML)
                </button>
                <button type="button" className="btn" onClick={() => downloadText(reportFileName(file.name, 'csv'), flowAToCsv(samples), 'text/csv')}>
                  <Icon name="table" size={18} /> Tabela (CSV)
                </button>
              </div>
            ) : (
              <p className="muted">Disponível quando a análise terminar com um perfil de impressão escolhido.</p>
            )}
          </Card>
          <Card title="Laudo da simulação" subtitle="Original contra simulação, região por região, com o resultado pelo percentil 95.">
            {sim ? (
              <div className="actions">
                <button type="button" className="btn primary" onClick={() => printHtml(flowBToHtml(sim, meta()))}>
                  <Icon name="print" size={18} /> Imprimir ou salvar em PDF
                </button>
                <button type="button" className="btn" onClick={() => downloadText(reportFileName(`${file.name}-simulacao`, 'html'), flowBToHtml(sim, meta()), 'text/html')}>
                  <Icon name="download" size={18} /> Laudo (HTML)
                </button>
                <button type="button" className="btn" onClick={() => downloadText(reportFileName(`${file.name}-simulacao`, 'csv'), flowBToCsv(sim), 'text/csv')}>
                  <Icon name="table" size={18} /> Tabela (CSV)
                </button>
              </div>
            ) : (
              <p className="muted">Disponível para imagens e PDFs em RGB, depois da simulação. PDFs em CMYK não têm versão RGB para comparar.</p>
            )}
          </Card>
        </div>
      )}
      <AboutPanel />
    </div>
  );
}
