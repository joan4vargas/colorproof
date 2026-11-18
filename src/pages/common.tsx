import type { ReactNode } from 'react';
import type { SpotColor } from '../lib/pdf/spotColors';
import { Status } from '../components/common';
import { Dropzone } from '../components/ui';
import { STAGE_LABEL, type Workspace } from '../state/useWorkspace';

export const ACCEPT = '.pdf,application/pdf,image/*';

/** Mensagens de andamento e erro, iguais em todas as páginas. */
export function Progress({ ws }: { ws: Workspace }) {
  return (
    <>
      {ws.busy && (
        <Status kind="info">
          {ws.stage ? STAGE_LABEL[ws.stage] : 'Enviando ao Worker…'}{' '}
          <button type="button" className="btn" onClick={ws.cancel}>
            Cancelar
          </button>
        </Status>
      )}
      {ws.error && <Status kind="error">Erro: {ws.error}</Status>}
      {ws.simulationError && <Status kind="error">Simulação: {ws.simulationError}</Status>}
    </>
  );
}

/** Página sem arquivo ainda: convida a enviar. */
export function EmptyFile({ ws, children }: { ws: Workspace; children?: ReactNode }) {
  return (
    <div className="stack">
      <Dropzone title="Solte o arquivo aqui" hint="PDF ou imagem" accept={ACCEPT} onFile={ws.pickFile} />
      {children}
      <Progress ws={ws} />
    </div>
  );
}

export function NeedProfile() {
  return <Status kind="info">Escolha o perfil de impressão no alto da página (ex.: ISO Coated v2).</Status>;
}

/** Este PDF usa cores spot (Pantone): diz quais são e leva ao CMYK de cada uma. */
export function SpotBanner({ spots, onOpen }: { spots: SpotColor[] | null; onOpen: () => void }) {
  if (!spots || spots.length === 0) return null;
  return (
    <div className="status info spot-banner">
      <div>
        <strong>Este PDF usa cores spot:</strong> {spots.map((s) => s.name).join(', ')}.
        <br />
        <span className="muted small">Abaixo elas aparecem pelo CMYK substituto que o arquivo guarda, não pelo Pantone.</span>
      </div>
      <button type="button" className="btn primary" onClick={onOpen}>
        Ver CMYK de cada cor
      </button>
    </div>
  );
}
