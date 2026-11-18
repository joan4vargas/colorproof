import { VERDICT_TEXT } from '../components/format';
// Visão geral: o resultado numa tela só. Simulação, nota do arquivo e as cores dele.

import Comparator from '../components/Comparator';
import { printedRgb, rgbCss, sourceRgb } from '../components/samples';
import { Card, Gauge } from '../components/ui';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, NeedProfile, Progress, SpotBanner } from './common';
import { visibleWarnings } from './warnings';

export default function OverviewPage({ ws, openSpots }: { ws: Workspace; openSpots: () => void }) {
  const { file, analysis, simulation: sim } = ws;
  if (!file) return <EmptyFile ws={ws} />;

  const report = analysis?.report ?? null;
  const findings = report?.findings ?? [];
  const page = sim?.report?.pages[0] ?? null;
  const thresholds = sim?.report?.thresholds ?? report?.thresholds;
  const above = page ? Math.round(page.shares.reprovado * page.compared) : 0;

  return (
    <div className="stack">
      <Progress ws={ws} />
      {!ws.profileName && <NeedProfile />}
      <SpotBanner spots={ws.fileSpots} onOpen={openSpots} />
      {visibleWarnings([...(sim?.warnings ?? []), ...(sim?.report?.warnings ?? []), ...(report?.warnings ?? [])], ws.fileSpots).map((w, i) => (
        <p key={i} className="status warn">
          {w}
        </p>
      ))}

      <div className="grid g-2-1">
        <Card title="Como fica impresso">
          {sim && thresholds ? <Comparator sim={sim} thresholds={thresholds} /> : <p className="muted">{ws.busy ? 'Gerando…' : 'Escolha o arquivo e o perfil.'}</p>}
        </Card>

        {page && (
          <Card title="Resultado">
            <Gauge value={page.p95DeltaE} verdict={page.verdict} />
            <p className="center">{VERDICT_TEXT[page.verdict]}</p>
            {above > 0 && <p className="muted small center">{above} regiões passam do limite.</p>}
          </Card>
        )}
        {!page && sim && (
          <Card title="Resultado">
            <p className="muted">{ws.fileSpots && ws.fileSpots.length > 0 ? 'Este PDF usa cores spot. Veja o CMYK de cada uma em Cores spot.' : 'Este PDF é CMYK. Veja o resultado por cor na página Amostras.'}</p>
          </Card>
        )}
      </div>

      {findings.length > 0 && (
        <Card title="Cores do arquivo">
          <div className="strip">
            {findings.map((f, i) => (
              <span key={i} className="strip-chip" title="Em cima: arquivo. Embaixo: impresso.">
                <i style={{ background: rgbCss(sourceRgb(f)) }} />
                <i style={{ background: rgbCss(printedRgb(f)) }} />
              </span>
            ))}
          </div>
          <p className="muted small">Em cima: no arquivo. Embaixo: impresso.</p>
        </Card>
      )}
    </div>
  );
}
