// Peças pequenas e compartilhadas da interface.

import type { ReactNode } from 'react';
import type { Verdict } from '../core/verdict';

const VERDICT_LABEL: Record<Verdict, string> = { aprovado: 'Aprovado', atencao: 'Atenção', reprovado: 'Reprovado' };

export function VerdictBadge({ verdict, big }: { verdict: Verdict; big?: boolean }) {
  return <span className={`verdict ${verdict}${big ? ' big-verdict' : ''}`}>{VERDICT_LABEL[verdict]}</span>;
}

export function FilePick(props: {
  label: string;
  buttonText: string;
  accept: string;
  fileName?: string | null;
  onFile: (file: File) => void;
}) {
  return (
    <div className="field">
      <span className="label">{props.label}</span>
      <label className="file-btn">
        {props.buttonText}
        <input
          type="file"
          accept={props.accept}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ''; // permite escolher o mesmo arquivo de novo
            if (f) props.onFile(f);
          }}
        />
      </label>
      {props.fileName && <strong>{props.fileName}</strong>}
    </div>
  );
}

export function Status({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`status ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
