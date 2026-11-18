import type { ReactNode } from 'react';
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
      <Dropzone title="Solte um PDF ou imagem aqui" hint="ou escolha no seu computador; o arquivo não sai dele" accept={ACCEPT} onFile={ws.pickFile} />
      {children}
      <Progress ws={ws} />
    </div>
  );
}

export function NeedProfile() {
  return <Status kind="info">Escolha a condição de impressão (perfil ICC CMYK de saída, como ISO Coated v2 ou PSO Coated v3, da ECI) no alto da página. Ele é lido só no seu computador.</Status>;
}
