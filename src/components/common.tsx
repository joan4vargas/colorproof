// Aviso reutilizável das telas (informação, atenção ou erro).

import type { ReactNode } from 'react';

export function Status({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`status ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
