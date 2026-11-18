// Simulação: o programa gera a versão impressa do arquivo; a pessoa só envia o arquivo.

import Comparator from '../components/Comparator';
import { fmtLab } from '../components/format';
import { rgbCss } from '../components/samples';
import { Card, Kpi, Pill } from '../components/ui';
import { labD50ToRgbClipped } from '../core/colorimetry';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, NeedProfile, Progress } from './common';

const num = (v: number) => v.toFixed(2).replace('.', ',');
const INTENT: Record<string, string> = { relative: 'colorimétrico relativo', perceptual: 'perceptual', saturation: 'saturação', absolute: 'colorimétrico absoluto' };

export default function SimulationPage({ ws }: { ws: Workspace }) {
  const { file, simulation: sim } = ws;
  if (!file) return <EmptyFile ws={ws} />;
  const report = sim?.report ?? null;
  const page = report?.pages[0] ?? null;

  return (
    <div className="stack">
      <Progress ws={ws} />
      {!ws.profileName && <NeedProfile />}
      {[...(sim?.warnings ?? []), ...(report?.warnings ?? [])].map((w, i) => (
        <p key={i} className="status warn">
          {w}
        </p>
      ))}

      {sim && report && (
        <Card title="Simulação de impressão" subtitle={`${file.name} · ${sim.width} × ${sim.height} px · intent ${INTENT[sim.intent] ?? sim.intent} · ${sim.totalMs.toFixed(0)} ms`}>
          <Comparator sim={sim} thresholds={report.thresholds} />
        </Card>
      )}
      {sim && !report && (
        <Card title="Simulação de impressão" subtitle={`${file.name} · PDF em CMYK`}>
          <Comparator sim={sim} thresholds={{ approvedMax: 3, attentionMax: 4 }} />
        </Card>
      )}

      {page && report && (
        <>
          <div className="kpis">
            <Kpi icon="shield" tone={page.verdict === 'aprovado' ? 'mint' : page.verdict === 'atencao' ? 'amber' : 'coral'} value={<Pill verdict={page.verdict} big />} label="Resultado" note="pelo percentil 95" />
            <Kpi icon="chart" tone="blue" value={num(page.p95DeltaE)} label="ΔE00 p95" note={`limite ${num(report.thresholds.approvedMax)}`} />
            <Kpi icon="chart" tone="blue" value={num(page.meanDeltaE)} label="ΔE00 médio" note={`pior caso ${num(page.maxDeltaE)}`} />
            <Kpi icon="grid" tone="mint" value={page.compared} label="Regiões comparadas" note={`grade ${report.grid} × ${report.grid}`} />
          </div>

          <Card title="Regiões mais afetadas" subtitle="Onde a impressão mais se afasta do arquivo. Regiões de borda ou fotografia são mistas: a cor dominante delas pesa menos.">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Região</th>
                    <th>Original → simulada</th>
                    <th>Lab original</th>
                    <th>ΔE00</th>
                    <th>Uniformidade</th>
                  </tr>
                </thead>
                <tbody>
                  {page.worst.map((w, i) => (
                    <tr key={i}>
                      <td>
                        linha {w.row + 1}, coluna {w.col + 1}
                      </td>
                      <td>
                        <span className="sw" style={{ background: rgbCss(labD50ToRgbClipped(w.reference)) }} />
                        <span className="sw" style={{ background: rgbCss(labD50ToRgbClipped(w.simulation)) }} />
                      </td>
                      <td>{fmtLab(w.reference)}</td>
                      <td>{num(w.deltaE)}</td>
                      <td>{w.minShare < 0.5 ? 'mista' : `${(w.minShare * 100).toFixed(0)}%`}</td>
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
