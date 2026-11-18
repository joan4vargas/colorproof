// Exportação do laudo (Fase 8): HTML autônomo (abre em qualquer navegador e
// imprime ou salva em PDF pelo diálogo de impressão) e CSV (para planilhas).
// Funções puras: recebem os dados e devolvem texto. O download em si fica na
// interface. Tudo o que vem do usuário (nomes de arquivo) é escapado.
//
// O texto do laudo repete, de propósito, o que a simulação NÃO é (L4): a norma
// ISO 12647 avalia material impresso medido com espectrofotômetro.

import { labD50ToRgbClipped } from '../../core/colorimetry';
import type { Verdict, VerdictThresholds } from '../../core/verdict';
import type { Cmyk, Lab, RGB } from '../../types/color';
import type { CompareOutcome } from '../compare/compareFiles';
import type { AnalysisOutcome } from '../analysis/analysisClient';
import type { FlowAReport } from './flowA';
import type { SpotMatch } from '../spot/spotMatch';

export interface ExportMeta {
  /** Quando o laudo foi gerado (injetado, para o texto ser reproduzível). */
  generatedAt: Date;
  appName?: string;
  appVersion?: string;
}

const VERDICT_LABEL: Record<Verdict, string> = { aprovado: 'Aprovado', atencao: 'Atenção', reprovado: 'Reprovado' };
const VERDICT_COLOR: Record<Verdict, string> = { aprovado: '#1b7f3b', atencao: '#a66a00', reprovado: '#b3261e' };
const INTENT_LABEL: Record<string, string> = {
  relative: 'colorimétrico relativo',
  absolute: 'colorimétrico absoluto',
  perceptual: 'perceptual',
  saturation: 'saturação',
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (v: number, digits = 2) => v.toFixed(digits);
const cmykText = (c: { c: number; m: number; y: number; k: number }) =>
  `${c.c.toFixed(0)} / ${c.m.toFixed(0)} / ${c.y.toFixed(0)} / ${c.k.toFixed(0)}`;
const labText = (l: Lab) => `${l.l.toFixed(2)} / ${l.a.toFixed(2)} / ${l.b.toFixed(2)}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const swatch = (rgb: RGB) =>
  `<span class="sw" style="background:rgb(${rgb.r},${rgb.g},${rgb.b})"></span>`;
const badge = (v: Verdict) => `<strong style="color:${VERDICT_COLOR[v]}">${VERDICT_LABEL[v]}</strong>`;
const dateText = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function thresholdsText(t: VerdictThresholds): string {
  return `aprovado até ΔE00 ${num(t.approvedMax, 1)}; atenção até ${num(t.attentionMax, 1)}; reprovado acima`;
}

/** Fonte dos limites, com ressalvas, para constar em todo laudo (ver docs/DOCUMENTACAO.md, seção 8c). */
const CRITERIA_HTML = `<h2>De onde vêm os limites</h2>
<ul>
<li><strong>3,0 (aprovado):</strong> ΔE*00 máximo dos sólidos de cores primárias e de cores spot na ISO 12647-7:2016 (prova contratual), Tabelas 30 e 31 do Fogra MediaStandard Print 2018.</li>
<li><strong>5,0:</strong> ΔE*00 máximo de todos os patches e P95 na mesma norma. Na ISO 12647-2:2013 o desvio dos sólidos é normativo em ΔE*ab ≤ 5 (os valores em ΔE*00 dessa tabela, K 5 e C, M, Y 3,5, são só informativos).</li>
<li><strong>2,5 (média, simulação):</strong> ΔE*00 médio de todos os patches (ISO 12647-7:2016).</li>
</ul>
<p class="note">A norma define limites de aprovação; a faixa "atenção", entre 3,0 e 5,0, é interpretação deste projeto. As normas avaliam material impresso e medido com espectrofotômetro; este laudo é uma simulação numérica (ΔE*ab e ΔH*ab são informativos). Fonte consultada: Fogra/bvdm, <em>MediaStandard Print 2018</em>, Tabelas 20, 30 e 31.</p>`;

const STYLE = `
body{font:14px/1.5 system-ui,'Segoe UI',Roboto,sans-serif;color:#1f2328;max-width:900px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:1.5rem 0 .5rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border:1px solid #d0d7de;padding:.35rem .5rem;text-align:left;vertical-align:middle}
th{background:#f6f8fa}.sw{display:inline-block;width:28px;height:16px;border:1px solid #888;vertical-align:middle;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.badge,th,.warn,.meta td:first-child{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.meta td:first-child{width:14rem;font-weight:600;background:#f6f8fa}.note{font-size:12px;color:#57606a}
.warn{background:#fff8c5;border:1px solid #d4a72c;padding:.4rem .6rem;margin:.4rem 0}
@media print{body{margin:0;max-width:none}}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>
${body}
</body></html>`;
}

function metaRows(rows: Array<[string, string]>): string {
  return `<table class="meta">${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join('')}</table>`;
}

function header(meta: ExportMeta, subtitle: string): string {
  const app = `${meta.appName ?? 'ColorProof'}${meta.appVersion ? ` ${escapeHtml(meta.appVersion)}` : ''}`;
  return `<h1>Simulação de conformidade de cor</h1><div class="note">${escapeHtml(subtitle)} · gerado por ${app} em ${dateText(meta.generatedAt)}</div>`;
}

const DISCLAIMER = `<h2>Como ler este laudo</h2>
<p class="note">Esta é uma <strong>simulação numérica</strong> feita no navegador com o perfil ICC indicado. Ela <strong>não</strong> é um laudo de conformidade ISO 12647: a norma avalia material impresso medido com espectrofotômetro. Os limites de ΔE00 (CIEDE2000) são decisão de projeto, não tolerâncias da norma. A cor é analisada em CIE L*a*b* (D50), independente do monitor. Compensação de ponto preto desligada. Elementos pequenos, texto fino, transparências e overprint podem não ser representados fielmente.</p>`;

function warningsHtml(warnings: string[]): string {
  return warnings.map((w) => `<div class="warn">Aviso: ${escapeHtml(w)}</div>`).join('');
}

// --- Fluxo A -------------------------------------------------------------

export interface FlowAExport {
  fileName: string;
  analysis: AnalysisOutcome;
  report: FlowAReport;
}

const hexOf = (c: RGB) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const inkChangeText = (ch: Cmyk) => {
  const parts = (['c', 'm', 'y', 'k'] as const)
    .filter((k) => Math.abs(ch[k]) >= 1)
    .map((k) => `${k.toUpperCase()} ${ch[k] > 0 ? '+' : '−'}${Math.abs(ch[k]).toFixed(0)}`);
  return parts.length ? parts.join(', ') : 'quase nenhuma';
};

function suggestionsHtml(report: FlowAReport): string {
  const rows = report.findings.filter((f) => f.source.kind === 'rgb' && f.verdict !== 'aprovado');
  if (rows.length === 0) return '';
  const lines = rows
    .map((f) => {
      const src = (f.source as { kind: 'rgb'; rgb: RGB }).rgb;
      const s = f.suggestion;
      if (!s) {
        return `<tr><td>${swatch(src)} sRGB ${src.r}, ${src.g}, ${src.b}</td><td colspan="5">Nenhuma cor próxima, com o mesmo matiz, que esta impressão reproduza dentro do limite.</td></tr>`;
      }
      return `<tr><td>${swatch(src)} sRGB ${src.r}, ${src.g}, ${src.b}</td><td>${swatch(s.rgb)} sRGB ${s.rgb.r}, ${s.rgb.g}, ${s.rgb.b} (${hexOf(s.rgb)})</td><td>${cmykText(s.cmyk)}</td><td>${escapeHtml(inkChangeText(s.cmykChange))}</td><td>${num(s.deltaEFromOriginal)}</td><td>${swatch(labD50ToRgbClipped(s.labPrinted))} ${num(s.deltaEPrint)}</td></tr>`;
    })
    .join('');
  return `<h2>Sugestões para as cores que não ficaram aprovadas</h2>
<table><thead><tr><th>Cor de origem</th><th>Cor sugerida</th><th>CMYK a especificar (%)</th><th>Mudança nas tintas (pontos)</th><th>Mudança visível (ΔE00)</th><th>Impressa: ΔE00 da sugerida</th></tr></thead><tbody>${lines}</tbody></table>
<p class="note">Nenhum valor de CMYK faz a impressão alcançar uma cor fora do gamut do perfil: o CMYK do perfil já é o mais próximo que ela chega. A sugestão troca a cor do projeto por outra, de mesmo matiz, que a impressão reproduz dentro do limite de aprovação (com margem). A coluna "mudança visível" diz quanto essa troca se afasta da cor original; é decisão de design aceitá-la.</p>`;
}

export function flowAToHtml(data: FlowAExport, meta: ExportMeta): string {
  const { fileName, analysis, report } = data;
  const rows = report.findings
    .map((f) => {
      const origin = f.source.kind === 'rgb' ? `sRGB ${f.source.rgb.r}, ${f.source.rgb.g}, ${f.source.rgb.b}` : `CMYK ${cmykText(f.source.cmyk)}`;
      const sw = f.source.kind === 'rgb' ? f.source.rgb : labD50ToRgbClipped(f.labSource);
      return `<tr><td>${swatch(sw)}</td><td>${escapeHtml(origin)}</td><td>${pct(f.pixelShare)}</td><td>${labText(f.labSource)}</td>
<td>${cmykText(f.cmykReproduced)}</td><td>${swatch(labD50ToRgbClipped(f.labRoundTrip))} ${labText(f.labRoundTrip)}</td><td>${num(f.deltaE)}</td><td>${num(f.deltaEab)}</td><td>${num(f.deltaH)}</td><td>${badge(f.verdict)}</td>${
        report.path === 'cmyk' ? `<td>${f.screenDeltaE !== undefined ? num(f.screenDeltaE) : ''}</td>` : ''
      }</tr>`;
    })
    .join('');
  const body = `${header(meta, 'Amostras: as cores do arquivo contra a condição de impressão (ida e volta pelo perfil ICC)')}
<h2>Resultado</h2>
<p>Resultado geral: ${badge(report.verdict)} (${escapeHtml(thresholdsText(report.thresholds))}). O resultado geral é o pior entre as cores.</p>
${metaRows([
  ['Arquivo', escapeHtml(fileName)],
  ['Páginas analisadas', `${analysis.analyzedPages} de ${analysis.numPages}`],
  ['Leitura da cor', analysis.path === 'cmyk' ? 'CMYK lido do arquivo (MuPDF), Lab pelo perfil' : 'sRGB (pdf.js ou navegador)'],
  ['Perfil ICC', escapeHtml(report.profileDescription)],
  ['Rendering intent', escapeHtml(INTENT_LABEL[report.intent] ?? report.intent)],
  ['Limites', escapeHtml(thresholdsText(report.thresholds))],
])}
${warningsHtml(report.warnings)}
<h2>Cores dominantes</h2>
<table><thead><tr><th></th><th>Cor de origem</th><th>Participação</th><th>Lab de origem</th><th>CMYK reproduzido (%)</th><th>Lab após round-trip</th><th>ΔE00</th><th>ΔE*ab</th><th>ΔH*ab</th><th>Veredito</th>${
    report.path === 'cmyk' ? '<th>ΔE00 na tela (informativo)</th>' : ''
  }</tr></thead><tbody>${rows}</tbody></table>
<p class="note">Participação: fração de todos os pixels, papel incluído. ${
    report.path === 'cmyk'
      ? 'No caminho CMYK, o ΔE00 na tela mede o quanto um monitor sRGB mostra da cor impressa e não entra no veredito. O CMYK reproduzido vem da tabela B2A do perfil e pode diferir da separação original.'
      : 'O ΔE00 compara a cor de origem com a que a condição de impressão reproduz (perda de gamut).'
  }</p>
${suggestionsHtml(report)}
${CRITERIA_HTML}
${DISCLAIMER}`;
  return page(`Laudo: ${fileName}`, body);
}

export function flowAToCsv(data: FlowAExport): string {
  const { fileName, report } = data;
  const head = ['arquivo', 'perfil', 'intent', 'origem', 'participacao_pixels', 'L_origem', 'a_origem', 'b_origem', 'C_reproduzido', 'M_reproduzido', 'Y_reproduzido', 'K_reproduzido', 'deltaE00', 'deltaEab', 'deltaHab', 'L_impresso', 'a_impresso', 'b_impresso', 'veredito', 'deltaE00_tela', 'sugestao_sRGB', 'sugestao_C', 'sugestao_M', 'sugestao_Y', 'sugestao_K', 'sugestao_mudanca_deltaE00'];
  const lines = report.findings.map((f) =>
    [
      fileName,
      report.profileDescription,
      report.intent,
      f.source.kind === 'rgb' ? `sRGB ${f.source.rgb.r} ${f.source.rgb.g} ${f.source.rgb.b}` : `CMYK ${cmykText(f.source.cmyk)}`,
      f.pixelShare,
      f.labSource.l,
      f.labSource.a,
      f.labSource.b,
      f.cmykReproduced.c,
      f.cmykReproduced.m,
      f.cmykReproduced.y,
      f.cmykReproduced.k,
      f.deltaE,
      f.deltaEab,
      f.deltaH,
      f.labRoundTrip.l,
      f.labRoundTrip.a,
      f.labRoundTrip.b,
      VERDICT_LABEL[f.verdict],
      f.screenDeltaE ?? '',
      f.suggestion ? `sRGB ${f.suggestion.rgb.r} ${f.suggestion.rgb.g} ${f.suggestion.rgb.b}` : '',
      f.suggestion?.cmyk.c ?? '',
      f.suggestion?.cmyk.m ?? '',
      f.suggestion?.cmyk.y ?? '',
      f.suggestion?.cmyk.k ?? '',
      f.suggestion?.deltaEFromOriginal ?? '',
    ].map(csvCell),
  );
  return csvJoin(head, lines);
}

// --- Fluxo B -------------------------------------------------------------

export interface FlowBExport {
  referenceName: string;
  simulationName: string;
  profileDescription: string | null;
  outcome: CompareOutcome;
}

export function flowBToHtml(data: FlowBExport, meta: ExportMeta): string {
  const { outcome, referenceName, simulationName, profileDescription } = data;
  const r = outcome.report;
  const pages = r.pages
    .map((p) => {
      const worst = p.worst
        .map(
          (w) =>
            `<tr><td>${w.row + 1}, ${w.col + 1}</td><td>${num(w.deltaE)}</td><td>${swatch(labD50ToRgbClipped(w.reference))} ${labText(w.reference)}</td><td>${swatch(labD50ToRgbClipped(w.simulation))} ${labText(w.simulation)}</td><td>${pct(w.minShare)}</td></tr>`,
        )
        .join('');
      return `<h2>Página ${p.pageNumber}</h2>
<p>${p.compared} regiões comparadas · ΔE00 médio ${num(p.meanDeltaE)} · p95 ${num(p.p95DeltaE)} · máximo ${num(p.maxDeltaE)} (pior caso: ${badge(p.worstCaseVerdict)}).<br>
Regiões aprovadas ${pct(p.shares.aprovado)} · atenção ${pct(p.shares.atencao)} · reprovadas ${pct(p.shares.reprovado)} · resultado da página: ${badge(p.verdict)}</p>
<table><thead><tr><th>Região (linha, coluna)</th><th>ΔE00</th><th>Lab referência</th><th>Lab simulação</th><th>Região uniforme</th></tr></thead><tbody>${worst}</tbody></table>`;
    })
    .join('');
  const side = (s: { path: string }) => (s.path === 'cmyk' ? 'CMYK (MuPDF + perfil)' : 'sRGB');
  const body = `${header(meta, 'Simulação de impressão: arquivo original contra a versão simulada')}
<h2>Resultado</h2>
<p>Resultado geral: ${badge(r.verdict)}, pelo percentil 95 do ΔE00 das regiões (${escapeHtml(thresholdsText(r.thresholds))}).</p>
${metaRows([
  ['Referência', `${escapeHtml(referenceName)} (${side(outcome.reference)})`],
  ['Simulação', `${escapeHtml(simulationName)} (${side(outcome.simulation)})`],
  ['Perfil ICC', profileDescription ? escapeHtml(profileDescription) : 'não usado (as duas versões em sRGB)'],
  ['Rendering intent', escapeHtml(INTENT_LABEL[outcome.intent] ?? outcome.intent)],
  ['Grade', `${r.grid} × ${r.grid} regiões por página`],
])}
${warningsHtml(r.warnings)}
${pages}
<p class="note">Cada região é comparada pela cor mais frequente dela. O pior caso é dominado por bordas e informado à parte; as piores regiões aparecem acima com a fração de uniformidade. Regiões que são papel nas duas versões não entram na conta. O resultado da página vem do percentil 95; uma média acima de 2,5 impede o "aprovado".</p>
${CRITERIA_HTML}
${DISCLAIMER}`;
  return page(`Comparação: ${referenceName} × ${simulationName}`, body);
}

export function flowBToCsv(data: FlowBExport): string {
  const { outcome, referenceName, simulationName } = data;
  const head = ['referencia', 'simulacao', 'pagina', 'linha', 'coluna', 'deltaE00', 'L_ref', 'a_ref', 'b_ref', 'L_sim', 'a_sim', 'b_sim', 'uniformidade'];
  const lines = outcome.report.pages.flatMap((p) =>
    p.worst.map((w) =>
      [referenceName, simulationName, p.pageNumber, w.row + 1, w.col + 1, w.deltaE, w.reference.l, w.reference.a, w.reference.b, w.simulation.l, w.simulation.a, w.simulation.b, w.minShare].map(csvCell),
    ),
  );
  return csvJoin(head, lines);
}

// --- CSV -----------------------------------------------------------------
// Separador ";" e decimal com vírgula: é o que o Excel em português abre
// direito. Começa com BOM UTF-8 para os acentos.

function csvCell(value: string | number): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4).replace('.', ',');
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; // evita fórmula em planilha
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvJoin(head: string[], lines: string[][]): string {
  return '﻿' + [head.join(';'), ...lines.map((l) => l.join(';'))].join('\r\n') + '\r\n';
}

// --- Cores spot (Pantone) -> CMYK ----------------------------------------------

export interface SpotExport {
  profileDescription: string;
  intent: string;
  thresholds: VerdictThresholds;
  rows: Array<{ match: SpotMatch; /** De onde veio o valor de referência (texto livre). */ origin: string }>;
}

export function spotToHtml(data: SpotExport, meta: ExportMeta): string {
  const lines = data.rows
    .map(({ match: m, origin }) => {
      const target = labD50ToRgbClipped(m.labTarget);
      const printed = labD50ToRgbClipped(m.labPrinted);
      return `<tr><td>${escapeHtml(m.name)}</td><td>${swatch(target)} ${escapeHtml(origin)}</td><td><strong>${cmykText(m.cmyk)}</strong></td><td>${swatch(printed)} ${labText(m.labPrinted)}</td><td>${num(m.deltaE)}</td><td>${badge(m.verdict)}</td><td>${[m.reproducible ? '' : 'Fora do gamut: aproximação', `Segunda opção (variação próxima): <strong>${cmykText(m.alternative.cmyk)}</strong>, ΔE00 ${num(m.alternative.deltaE)}`].filter(Boolean).join('<br>')}</td></tr>`;
    })
    .join('');
  const body = `${header(meta, 'Cores spot (Pantone) para CMYK: o CMYK que mais se aproxima de cada cor')}
${metaRows([
  ['Perfil ICC', escapeHtml(data.profileDescription)],
  ['Rendering intent', escapeHtml(INTENT_LABEL[data.intent] ?? data.intent)],
  ['Limites', escapeHtml(thresholdsText(data.thresholds))],
])}
<h2>Cores</h2>
<table><thead><tr><th>Cor</th><th>Referência</th><th>CMYK recomendado (%)</th><th>Como imprime (Lab)</th><th>ΔE00</th><th>Resultado</th><th>Observação</th></tr></thead><tbody>${lines}</tbody></table>
<p class="note">O CMYK é calculado pelo perfil indicado (tabela inversa B2A, seguida de uma busca que minimiza o ΔE00 contra a previsão da tabela A2B) e arredondado para inteiros. O valor de referência de cada cor vem da coluna "Referência": o app não distribui a biblioteca Pantone. Cores fora do gamut do CMYK (muitos laranjas, verdes e azuis vivos), metálicas e fluorescentes não são reproduzíveis: o resultado é a melhor aproximação e o ΔE00 mostra o tamanho da perda. O CMYK pode diferir do que o fabricante da biblioteca publica, que usa outra condição de impressão.</p>
${CRITERIA_HTML}
${DISCLAIMER}`;
  return page('Laudo: cores spot para CMYK', body);
}

export function spotToCsv(data: SpotExport): string {
  const head = ['cor', 'referencia', 'perfil', 'intent', 'C', 'M', 'Y', 'K', 'tinta_total', 'L_impresso', 'a_impresso', 'b_impresso', 'deltaE00', 'resultado', 'dentro_do_gamut', 'alt_C', 'alt_M', 'alt_Y', 'alt_K', 'alt_deltaE00'];
  const lines = data.rows.map(({ match: m, origin }) =>
    [m.name, origin, data.profileDescription, data.intent, m.cmyk.c, m.cmyk.m, m.cmyk.y, m.cmyk.k, m.totalInk, m.labPrinted.l, m.labPrinted.a, m.labPrinted.b, m.deltaE, VERDICT_LABEL[m.verdict], m.reproducible ? 'sim' : 'não', m.alternative.cmyk.c, m.alternative.cmyk.m, m.alternative.cmyk.y, m.alternative.cmyk.k, m.alternative.deltaE].map(csvCell),
  );
  return csvJoin(head, lines);
}
