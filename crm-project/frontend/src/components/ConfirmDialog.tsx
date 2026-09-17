import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react';
import { Modal } from './Modal';
import { IconAlert, IconTrash } from './Icons';

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  /** Ek açıklama — sonucun ne olacağını anlatır. */
  detail?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState extends ConfirmOptions {
  open: boolean;
}

const CLOSED: PendingState = { open: false, message: '' };

/**
 * Kurumsal onay iletişim kutusu.
 *
 * Tarayıcının `window.confirm()` kutusu yerine kullanılır: o kutu
 * "localhost:8080 diyor ki…" başlığıyla çıkar, biçimlendirilemez ve
 * kurumsal bir uygulamada yabancı durur. Ayrıca senkron olduğu için
 * ana iş parçacığını bloklar.
 *
 * Söz (promise) tabanlıdır; çağrı yeri `if (await confirm({...}))`
 * şeklinde `window.confirm` ile neredeyse birebir aynı kalır.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<PendingState>(CLOSED);
  // Açık diyaloğun sözünü çözecek fonksiyon.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    // Önceki diyalog hâlâ açıksa iptal edilmiş sayılır; iki diyalog
    // aynı anda görünmez.
    resolverRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState(CLOSED);
  }, []);

  const tone = state.tone ?? 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <Modal
        open={state.open}
        title={state.title ?? 'Onay Gerekiyor'}
        onClose={() => settle(false)}
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => settle(false)}>
              {state.cancelLabel ?? 'Vazgeç'}
            </button>
            <button
              type="button"
              className={tone === 'danger' ? 'btn btn-danger' : 'btn btn-crimson'}
              onClick={() => settle(true)}
              autoFocus
            >
              {state.confirmLabel ?? 'Evet, Sil'}
            </button>
          </>
        }
      >
        <div className={`confirm-icon ${tone}`}>
          {tone === 'danger' ? <IconTrash size={22} /> : <IconAlert size={22} />}
        </div>

        <div className="confirm-body">{state.message}</div>
        {state.detail && <div className="confirm-detail">{state.detail}</div>}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * `const confirm = useConfirm();` → `if (!(await confirm({ message: '…' }))) return;`
 */
export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm yalnızca <ConfirmProvider> içinde kullanılabilir.');
  return context;
}

/** Sık kullanılan "kaydı sil" onayı için hazır yardımcı. */
export function useDeleteConfirm(): (name: string, detail?: ReactNode) => Promise<boolean> {
  const confirm = useConfirm();
  return useMemo(
    () => (name: string, detail?: ReactNode) =>
      confirm({
        title: 'Silme Onayı',
        message: (
          <>
            <strong>{name}</strong> kaydını silmek istediğinize emin misiniz?
          </>
        ),
        detail,
        confirmLabel: 'Evet, Sil',
        tone: 'danger',
      }),
    [confirm],
  );
}
