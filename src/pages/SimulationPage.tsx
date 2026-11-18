// Simulação: o programa gera a versão impressa do arquivo; a pessoa só envia o arquivo.

import Comparator from '../components/Comparator';
import { fmtLab, VERDICT_TEXT } from '../components/format';
import { rgbCss } from '../components/samples';
import { Card, Help, Pill } from '../components/ui';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { DEFAULT_THRESHOLDS } from '../core/verdict';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, NeedProfile, Progress, SpotBanner } from './common';
import { visibleWarnings } from './warnings';

const num = (v: number) => v.toFixed(2).replace('.', ',');

export default function SimulationPage({ ws, openSpots }: { ws: Workspace; openSpots: () => void }) {
  const { file, simulation: sim } = ws;
  if (!file) return <EmptyFile ws={ws} />;
  const report = sim?.report ?? null;
  const page = report?.pages[0] ?? null;

  return (
    <div className="stack">
      <Progress ws={ws} />
      {!ws.profileName && <NeedProfile />}
      <SpotBanner spots={ws.fileSpots} onOpen={openSpots} />
      {visibleWarnings([...(sim?.warnings ?? []), ...(report?.warnings ?? [])], ws.fileSpots).map((w, i) => (
        <p key={i} className="status warn">
          {w}
        </p>
      ))}

      {sim && (
        <Card title="Como fica impresso">
          {page && (
            <p className="verdict-line">
              <Pill verdict={page.verdict} big /> <span>{VERDICT_TEXT[page.verdict]}</span>
            </p>
          )}
          {sim.numPages > 1 && (
            <div className="page-nav">
              <button type="button" className="btn" disabled={ws.busy || sim.page <= 1} onClick={() => void ws.goToPage(sim.page - 1)}>
                Anterior
              </button>
              <label className="small">
                Página{' '}
                <select value={sim.page} disabled={ws.busy} onChange={(e) => void ws.goToPage(Number(e.target.value))}>
                  {Array.from({ length: sim.numPages }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>{' '}
                de {sim.numPages}
              </label>
              <button type="button" className="btn" disabled={ws.busy || sim.page >= sim.numPages} onClick={() => void ws.goToPage(sim.page + 1)}>
                Próxima
              </button>
            </div>
          )}
          <Comparator sim={sim} thresholds={report?.thresholds ?? DEFAULT_THRESHOLDS} />
          {!page && <p className="muted small">PDF em CMYK: veja o resultado por cor na página Amostras.</p>}
        </Card>
      )}

      {page && report && (
        <Help title="Onde a cor mais muda">
          <p className="muted small">
            Diferença média {num(page.meanDeltaE)} · maior {num(page.maxDeltaE)} · {page.compared} regiões comparadas.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Região</th>
                  <th>Arquivo → impresso</th>
                  <th>Lab</th>
                  <th>ΔE</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Help>
      )}
    </div>
  );
}
