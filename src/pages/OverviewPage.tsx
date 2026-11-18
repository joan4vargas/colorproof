// Visão geral: tudo numa tela. Comparador, laudo em medidor, indicadores,
// amostras da imagem e tabela das amostras analisadas.

import Comparator from '../components/Comparator';
import { fmtLab } from '../components/format';
import { printedRgb, rgbCss, sourceRgb } from '../components/samples';
import { Card, DeltaBar, Gauge, Kpi, Pill } from '../components/ui';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, NeedProfile, Progress } from './common';

const num = (v: number) => v.toFixed(2).replace('.', ',');

export default function OverviewPage({ ws }: { ws: Workspace }) {
  const { file, analysis, simulation } = ws;
  if (!file) return <EmptyFile ws={ws} />;

  const report = analysis?.report ?? null;
  const findings = report?.findings ?? [];
  const sim = simulation;
  const page = sim?.report?.pages[0] ?? null;
  const thresholds = sim?.report?.thresholds ?? report?.thresholds;
  const above = page ? Math.round(page.shares.reprovado * page.compared) : 0;

  return (
    <div className="stack">
      <Progress ws={ws} />
      {!ws.profileName && <NeedProfile />}
      {[...(sim?.warnings ?? []), ...(sim?.report?.warnings ?? []), ...(report?.warnings ?? [])].map((w, i) => (
        <p key={i} className="status warn">
          {w}
        </p>
      ))}

      <div className="grid g-2-1">
        <Card title="Simulação de impressão" subtitle={file.name}>
          {sim && thresholds ? <Comparator sim={sim} thresholds={thresholds} /> : <p className="muted">{ws.busy ? 'Gerando a simulação…' : 'A simulação aparece aqui quando houver um perfil e um arquivo.'}</p>}
        </Card>

        <div className="stack">
          <Card title="Laudo de conformidade" subtitle="Simulação numérica, não laudo ISO 12647">
            {page ? (
              <>
                <Gauge value={page.p95DeltaE} verdict={page.verdict} />
                <p className="muted small center">
                  ΔE00 no percentil 95 das regiões. Aprovado até {num(sim!.report!.thresholds.approvedMax)}, atenção até {num(sim!.report!.thresholds.attentionMax)}.
                </p>
              </>
            ) : (
              <p className="muted">{sim && !page ? 'PDF em CMYK: não há versão RGB para comparar, veja as amostras.' : 'Sem resultado ainda.'}</p>
            )}
          </Card>
          {page && (
            <div className="kpis kpis-3">
              <Kpi icon="chart" tone="blue" value={num(page.meanDeltaE)} label="ΔE00 médio" note="das regiões" />
              <Kpi icon="grid" tone="mint" value={page.compared} label="Regiões" note="com tinta" />
              <Kpi icon="shield" tone={above === 0 ? 'mint' : 'coral'} value={above} label="Acima do limite" note={`${(page.shares.reprovado * 100).toFixed(1).replace('.', ',')}% das regiões`} />
            </div>
          )}
        </div>
      </div>

      {findings.length > 0 && (
        <>
          <Card title="Amostras da imagem" subtitle="As cores dominantes: no arquivo (em cima) e depois da impressão simulada (embaixo)">
            <div className="strip">
              {findings.map((f, i) => (
                <span key={i} className="strip-chip" title={`ΔE00 ${f.deltaE.toFixed(2)}`}>
                  <i style={{ background: rgbCss(sourceRgb(f)) }} />
                  <i style={{ background: rgbCss(printedRgb(f)) }} />
                </span>
              ))}
            </div>
          </Card>

          <Card title="Amostras analisadas" subtitle={`${findings.length} cores · perfil ${report!.profileDescription}`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Amostra</th>
                    <th>L* a* b* (referência)</th>
                    <th>ΔE00</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={i}>
                      <td>
                        <span className="sw" style={{ background: rgbCss(sourceRgb(f)) }} />
                        <span className="sw" style={{ background: rgbCss(printedRgb(f)) }} />
                      </td>
                      <td>{fmtLab(f.labSource)}</td>
                      <td>
                        <DeltaBar value={f.deltaE} verdict={f.verdict} thresholds={report!.thresholds} />
                      </td>
                      <td>
                        <Pill verdict={f.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
