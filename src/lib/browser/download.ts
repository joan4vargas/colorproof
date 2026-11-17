// Saída do laudo no navegador: baixar arquivo e imprimir (ou salvar em PDF pelo
// diálogo de impressão). Sem servidor: tudo local.

export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Imprime um documento HTML completo num iframe oculto (o usuário escolhe "Salvar como PDF"). */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

/** Nome de arquivo seguro para o laudo: sem extensão original, sem caracteres problemáticos. */
export function reportFileName(base: string, extension: string): string {
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'arquivo';
  return `laudo-${stem}.${extension}`;
}
