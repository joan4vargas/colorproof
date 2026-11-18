// Amostras (antigo Fluxo A): as cores dominantes do arquivo, cada uma como um
// retângulo colorido (arquivo e impresso) com a referência CMYK reproduzida.

import { fmtCmyk, hexOf, inkChanges, VERDICT_TEXT } from '../components/format';
import { originText, printedRgb, rgbCss, sourceRgb } from '../components/samples';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { Card, Help, Pill } from '../components/ui';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, NeedProfile, Progress, SpotBanner } from './common';
import { visibleWarnings } from './warnings';

export default function SamplesPage({ ws, openSpots }: { ws: Workspace; openSpots: () => void }) {
  const { file, analysis } = ws;
  if (!file) return <EmptyFile ws={ws} />;
  const report = analysis?.report ?? null;

  return (
    <div className="stack">
      <Progress ws={ws} />
      {!ws.profileName && <NeedProfile />}
      <SpotBanner spots={ws.fileSpots} onOpen={openSpots} />
      {visibleWarnings(report?.warnings ?? [], ws.fileSpots).map((w, i) => (
        <p key={i} className="status warn">
          {w}
        </p>
      ))}

      {report && (
        <>
          <Card title="Cores do arquivo">
            <div className="swatches">
              {report.findings.map((f, i) => (
                <article key={i} className="swatch-card">
                  <div className="swatch-big" role="img" aria-label={`Cor ${i + 1}: arquivo e impresso`}>
                    <span style={{ background: rgbCss(sourceRgb(f)) }}>
                      <small>Arquivo</small>
                    </span>
                    <span style={{ background: rgbCss(printedRgb(f)) }}>
                      <small>Impresso</small>
                    </span>
                  </div>
                  <div className="swatch-head">
                    <strong>{originText(f)}</strong>
                    <Pill verdict={f.verdict} />
                  </div>
                  <p className="muted small">{VERDICT_TEXT[f.verdict]}</p>
                  <p className="small label-line">CMYK</p>
                  <p className="cmyk-big">{fmtCmyk(f.cmykReproduced)}</p>
                  {f.verdict !== 'aprovado' && f.source.kind === 'rgb' && (
                    <Help title="Como ajustar">
                      {f.suggestion ? (
                        <>
                          <div className="suggest-sw" role="img" aria-label="Cor sugerida e como ela sai impressa">
                            <span style={{ background: rgbCss(f.suggestion.rgb) }}>
                              <small>Sugerida</small>
                            </span>
                            <span style={{ background: rgbCss(labD50ToRgbClipped(f.suggestion.labPrinted)) }}>
                              <small>Impressa</small>
                            </span>
                          </div>
                          <p className="small">
                            Use <strong>{hexOf(f.suggestion.rgb)}</strong> (sRGB {f.suggestion.rgb.r}, {f.suggestion.rgb.g}, {f.suggestion.rgb.b}) no lugar de {hexOf(f.source.rgb)}.
                          </p>
                          <p className="small">
                            CMYK: <strong>{fmtCmyk(f.suggestion.cmyk)}</strong>
                            {inkChanges(f.suggestion.cmykChange) ? ` (${inkChanges(f.suggestion.cmykChange)})` : ''}
                          </p>
                        </>
                      ) : (
                        <p className="muted small">Não há uma cor parecida que essa impressão reproduza.</p>
                      )}
                    </Help>
                  )}
                </article>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
