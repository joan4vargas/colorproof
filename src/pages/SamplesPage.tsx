// Amostras (antigo Fluxo A): as cores dominantes do arquivo, cada uma como um
// retângulo colorido (arquivo e impresso) com a referência CMYK reproduzida.

import { fmtCmyk, fmtLab, hexOf, inkChanges, num2 } from '../components/format';
import { originText, printedRgb, rgbCss, sourceRgb } from '../components/samples';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { Card, DeltaBar, Inks, Pill, ShareBar } from '../components/ui';
import type { Workspace } from '../state/useWorkspace';
import { EmptyFile, NeedProfile, Progress } from './common';

export default function SamplesPage({ ws }: { ws: Workspace }) {
  const { file, analysis } = ws;
  if (!file) return <EmptyFile ws={ws} />;
  const report = analysis?.report ?? null;

  return (
    <div className="stack">
      <Progress ws={ws} />
      {!ws.profileName && <NeedProfile />}
      {report?.warnings.map((w, i) => (
        <p key={i} className="status warn">
          {w}
        </p>
      ))}
      {analysis && !report && ws.profileName && <p className="status">Análise concluída, mas sem veredito. Escolha o perfil de impressão no alto da página.</p>}

      {report && (
        <>
          <Card
            title="Amostras"
            subtitle={`${file.name} · ${report.findings.length} cores dominantes, da maior para a menor área · perfil ${report.profileDescription} · ${analysis!.path === 'cmyk' ? 'CMYK lido do arquivo' : 'sRGB'}`}
          >
            <div className="swatches">
              {report.findings.map((f, i) => (
                <article key={i} className="swatch-card">
                  <div className="swatch-big" role="img" aria-label={`Amostra ${i + 1}: arquivo e impresso`}>
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
                  <p className="muted small">Lab {fmtLab(f.labSource)}</p>
                  <p className="small label-line">Referência CMYK reproduzida</p>
                  <Inks cmyk={f.cmykReproduced} />
                  <p className="small label-line">ΔE00</p>
                  <DeltaBar value={f.deltaE} verdict={f.verdict} thresholds={report.thresholds} />
                  <p className="small label-line">Área da imagem</p>
                  <ShareBar value={f.pixelShare} />
                  {f.verdict !== 'aprovado' && f.source.kind === 'rgb' && (
                    <div className="suggest">
                      <p className="small label-line">Para ficar conforme</p>
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
                            Troque sRGB {f.source.rgb.r}, {f.source.rgb.g}, {f.source.rgb.b} por{' '}
                            <strong>
                              sRGB {f.suggestion.rgb.r}, {f.suggestion.rgb.g}, {f.suggestion.rgb.b} ({hexOf(f.suggestion.rgb)})
                            </strong>
                            .
                          </p>
                          <p className="small">
                            CMYK a especificar: <strong>{fmtCmyk(f.suggestion.cmyk)}</strong>.{' '}
                            {inkChanges(f.suggestion.cmykChange)
                              ? `Mudança nas tintas: ${inkChanges(f.suggestion.cmykChange)}.`
                              : 'As tintas quase não mudam: o ajuste está na cor do projeto, não na tinta.'}
                          </p>
                          <p className="muted small">
                            A cor muda ΔE00 {num2(f.suggestion.deltaEFromOriginal)} em relação à original. Impressa, fica a ΔE00 {num2(f.suggestion.deltaEPrint)} da sugerida (dentro do limite).
                          </p>
                        </>
                      ) : (
                        <p className="muted small">Não achei uma cor próxima, com o mesmo matiz, que essa impressão reproduza dentro do limite.</p>
                      )}
                    </div>
                  )}
                  {f.spread >= 5 && <p className="muted small">Cor com muita variação (degradê ou foto): o ΔE00 vale para o valor central.</p>}
                </article>
              ))}
            </div>
          </Card>
          {report.path === 'cmyk' && <p className="muted small">O retângulo “Arquivo” de um PDF em CMYK é o CMYK do arquivo visto pelo perfil; a diferença para a tela (ΔE00 na tela) é informativa e não entra no veredito.</p>}
        </>
      )}
    </div>
  );
}
