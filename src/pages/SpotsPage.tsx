// Cores spot (Pantone): digitar ou ler do PDF o valor de referência de cada cor
// e receber o CMYK que mais se aproxima dela na condição de impressão.

import { fmtLab, inkChanges, num2 } from '../components/format';
import { rgbCss } from '../components/samples';
import { Card, DeltaBar, Icon, Inks, Pill } from '../components/ui';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { DEFAULT_THRESHOLDS } from '../core/verdict';
import { ALT_MIN_STEP } from '../lib/spot/spotMatch';
import { downloadText, printHtml, reportFileName } from '../lib/browser/download';
import { spotToCsv, spotToHtml, type SpotExport } from '../lib/report/export';
import { isPdf } from '../components/format';
import { Status } from '../components/common';
import type { SpotMode, SpotRow, useSpots } from '../state/useSpots';
import type { Workspace } from '../state/useWorkspace';

type Spots = ReturnType<typeof useSpots>;

const MODES: Array<{ id: SpotMode; label: string }> = [
  { id: 'lab', label: 'Lab' },
  { id: 'hex', label: 'Hexadecimal' },
  { id: 'cmyk', label: 'CMYK' },
];

function Field(props: { label: string; value: string; onChange: (v: string) => void; width?: string; placeholder?: string }) {
  return (
    <label className="field" style={{ width: props.width }}>
      <span className="muted small">{props.label}</span>
      <input type="text" inputMode="decimal" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function RowEditor({ row, update, remove }: { row: SpotRow; update: Spots['update']; remove: (id: number) => void }) {
  // editar o valor à mão desfaz a origem "do PDF": o laudo passa a dizer "digitado"
  const edit = (patch: Partial<SpotRow>) => update(row.id, { ...patch, origin: 'digitado' });
  return (
    <div className="spot-row">
      <label className="field grow">
        <span className="muted small">Nome da cor</span>
        <input type="text" value={row.name} placeholder="Ex.: PANTONE 186 C" onChange={(e) => update(row.id, { name: e.target.value })} />
      </label>
      <div className="seg" role="group" aria-label={`Tipo de valor de ${row.name || 'cor'}`}>
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={row.mode === m.id} onClick={() => edit({ mode: m.id })}>
            {m.label}
          </button>
        ))}
      </div>
      {row.mode === 'lab' && (
        <div className="fields">
          <Field label="L*" value={row.l} width="5.5rem" onChange={(v) => edit({ l: v })} />
          <Field label="a*" value={row.a} width="5.5rem" onChange={(v) => edit({ a: v })} />
          <Field label="b*" value={row.b} width="5.5rem" onChange={(v) => edit({ b: v })} />
        </div>
      )}
      {row.mode === 'hex' && (
        <div className="fields">
          <Field label="Hexadecimal (sRGB)" value={row.hex} width="10rem" placeholder="#E4002B" onChange={(v) => edit({ hex: v })} />
        </div>
      )}
      {row.mode === 'cmyk' && (
        <div className="fields">
          <Field label="C" value={row.c} width="4.5rem" onChange={(v) => edit({ c: v })} />
          <Field label="M" value={row.m} width="4.5rem" onChange={(v) => edit({ m: v })} />
          <Field label="Y" value={row.y} width="4.5rem" onChange={(v) => edit({ y: v })} />
          <Field label="K" value={row.k} width="4.5rem" onChange={(v) => edit({ k: v })} />
        </div>
      )}
      <button type="button" className="btn" onClick={() => remove(row.id)} aria-label={`Remover ${row.name || 'cor'}`}>
        Remover
      </button>
      {row.warning && <p className="status warn spot-warn">{row.warning}</p>}
    </div>
  );
}

export default function SpotsPage({ ws, spots }: { ws: Workspace; spots: Spots }) {
  const { rows, intent, setIntent, result, busy, error, info, update, add, remove, readFromPdf, calculate } = spots;
  const canRead = ws.file !== null && isPdf(ws.file);

  const exportData: SpotExport | null = result
    ? {
        profileDescription: result.profileDescription,
        intent: result.intent,
        thresholds: DEFAULT_THRESHOLDS,
        rows: result.matches.map((match, i) => ({ match, origin: result.rows[i]?.origin ?? 'digitado' })),
      }
    : null;
  const meta = () => ({ generatedAt: new Date(), appName: 'ColorProof' });

  return (
    <div className="stack">
      {!ws.profileName && <Status kind="info">Escolha a condição de impressão (perfil ICC CMYK) no alto da página para calcular o CMYK.</Status>}

      <Card title="Valores de referência" subtitle="Informe o valor de cada cor e veja o CMYK que mais se aproxima dela">
        <p className="muted small">
          O app não traz a biblioteca Pantone (ela é proprietária). O valor de referência pode vir do PDF (quando o arquivo declara o Lab do spot), do Pantone Connect ou do Color Bridge, ou de uma medição do
          impresso com espectrofotômetro, que é a referência mais fiel. Informe em Lab (D50) quando puder: o hexadecimal é uma conversão para a tela e perde fidelidade.
        </p>
        <div className="spot-list">
          {rows.map((row) => (
            <RowEditor key={row.id} row={row} update={update} remove={remove} />
          ))}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={add}>
            Adicionar cor
          </button>
          <button type="button" className="btn" onClick={() => void readFromPdf()} disabled={!canRead || busy} title={canRead ? undefined : 'Envie um PDF no alto da página para ler os spots dele'}>
            <Icon name="upload" size={18} /> Ler spots do PDF
          </button>
          <div className="seg" role="group" aria-label="Referência do valor">
            <button type="button" aria-pressed={intent === 'relative'} onClick={() => setIntent('relative')} title="O branco do papel vira o branco da referência. Padrão.">
              Relativo ao papel
            </button>
            <button type="button" aria-pressed={intent === 'absolute'} onClick={() => setIntent('absolute')} title="Use se o Lab de referência foi medido com o papel incluído.">
              Absoluto
            </button>
          </div>
          <button type="button" className="btn primary" onClick={() => void calculate()} disabled={busy || !ws.profileName}>
            Calcular CMYK
          </button>
        </div>
        {info && <p className="muted small">{info}</p>}
        {error && <Status kind="error">Erro: {error}</Status>}
      </Card>

      {result && exportData && (
        <>
          <Card title="CMYK recomendado" subtitle={`Perfil ${result.profileDescription} · ${result.intent === 'relative' ? 'colorimétrico relativo' : 'colorimétrico absoluto'}`}>
            <div className="swatches">
              {result.matches.map((m, i) => (
                <article key={i} className="swatch-card">
                  <div className="swatch-big" role="img" aria-label={`${m.name}: referência e como imprime`}>
                    <span style={{ background: rgbCss(labD50ToRgbClipped(m.labTarget)) }}>
                      <small>Referência</small>
                    </span>
                    <span style={{ background: rgbCss(labD50ToRgbClipped(m.labPrinted)) }}>
                      <small>Impresso</small>
                    </span>
                  </div>
                  <div className="swatch-head">
                    <strong>{m.name}</strong>
                    <Pill verdict={m.verdict} />
                  </div>
                  <p className="muted small">
                    Lab {fmtLab(m.labTarget)} · {result.rows[i]?.origin}
                  </p>
                  <p className="small label-line">CMYK a usar</p>
                  <p className="cmyk-big">
                    C {m.cmyk.c} · M {m.cmyk.m} · Y {m.cmyk.y} · K {m.cmyk.k}
                  </p>
                  <Inks cmyk={m.cmyk} />
                  <p className="muted small">Tinta total {m.totalInk}%</p>
                  <p className="small label-line">ΔE00 contra a referência</p>
                  <DeltaBar value={m.deltaE} verdict={m.verdict} thresholds={DEFAULT_THRESHOLDS} />
                  {!m.reproducible && <p className="muted small">Fora do alcance do CMYK nesta condição de impressão: este é o CMYK mais próximo possível, e o ΔE00 mostra o que se perde. Cores metálicas e fluorescentes também não saem em CMYK.</p>}
                  {m.improved && <p className="muted small">A busca melhorou o ΔE00 de {num2(m.deltaEB2A)} (só pela tabela do perfil, CMYK {m.cmykB2A.c}/{m.cmykB2A.m}/{m.cmykB2A.y}/{m.cmykB2A.k}) para {num2(m.deltaE)}{inkChanges({ c: m.cmyk.c - m.cmykB2A.c, m: m.cmyk.m - m.cmykB2A.m, y: m.cmyk.y - m.cmykB2A.y, k: m.cmyk.k - m.cmykB2A.k }) ? ` (${inkChanges({ c: m.cmyk.c - m.cmykB2A.c, m: m.cmyk.m - m.cmykB2A.m, y: m.cmyk.y - m.cmykB2A.y, k: m.cmyk.k - m.cmykB2A.k })})` : ''}.</p>}
                  <div className="spot-alt">
                    <div className="spot-alt-head">
                      <span className="swatch-mini" style={{ background: rgbCss(labD50ToRgbClipped(m.alternative.labPrinted)) }} aria-hidden="true" />
                      <p className="small label-line">Segunda opção (variação próxima)</p>
                    </div>
                    <p className="cmyk-big alt">
                      C {m.alternative.cmyk.c} · M {m.alternative.cmyk.m} · Y {m.alternative.cmyk.y} · K {m.alternative.cmyk.k}
                    </p>
                    <p className="muted small">
                      ΔE00 {num2(m.alternative.deltaE)} (+{num2(m.alternative.deltaEExtra)} sobre a primeira) · tinta total {m.alternative.totalInk}%
                    </p>
                    <p className="muted small">
                      É o segundo CMYK mais próximo, com pelo menos {ALT_MIN_STEP} pontos de diferença em algum canal. Serve para imprimir as duas opções ao lado do Pantone e escolher a olho; pelo cálculo, a primeira é a melhor.
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </Card>
          <Card title="Exportar" subtitle="Tabela de equivalência para enviar ao cliente ou à gráfica">
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => printHtml(spotToHtml(exportData, meta()))}>
                <Icon name="print" size={18} /> Imprimir ou salvar em PDF
              </button>
              <button type="button" className="btn" onClick={() => downloadText(reportFileName('cores-spot', 'html'), spotToHtml(exportData, meta()), 'text/html')}>
                <Icon name="download" size={18} /> Laudo (HTML)
              </button>
              <button type="button" className="btn" onClick={() => downloadText(reportFileName('cores-spot', 'csv'), spotToCsv(exportData), 'text/csv')}>
                <Icon name="table" size={18} /> Tabela (CSV)
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
