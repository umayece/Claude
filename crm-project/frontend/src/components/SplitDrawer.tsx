import { useEffect, type ReactNode } from 'react';
import { IconX } from './Icons';

export interface DrawerTab {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

interface Props {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Aşama çubuğu — başlığın hemen altında sabit durur. */
  stageBar?: ReactNode;
  /** Sol kolon: sabit künye bilgileri. */
  left: ReactNode;
  tabs: DrawerTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Sağ kolon: aktif sekmenin içeriği. */
  children: ReactNode;
  headerActions?: ReactNode;
}

/**
 * Bitrix24 tarzı çift kolonlu 360° çekmece.
 *
 * Sol kolon sabit künye, sağ kolon canlı etkileşim alanıdır. İki kolon
 * BAĞIMSIZ kaydırılır: uzun bir zaman tüneli okunurken künyenin ekrandan
 * kaybolmaması gerekir.
 */
export function SplitDrawer({
  open, title, subtitle, onClose, stageBar, left,
  tabs, activeTab, onTabChange, children, headerActions,
}: Props) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      // Esc yalnızca en üstteki katmanı kapatmalı; iç modallar olayı
      // kendileri yakalayıp durdurur.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />

      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-topbar">
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="drawer-title">{title}</div>
            {subtitle && <div className="text-sm text-muted truncate">{subtitle}</div>}
          </div>

          {headerActions}

          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            <IconX size={18} />
          </button>
        </div>

        {stageBar && <div className="drawer-stage">{stageBar}</div>}

        <div className="drawer-split">
          <div className="drawer-left">{left}</div>

          <div className="drawer-right">
            <div className="drawer-tabs" role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={tab.key === activeTab}
                  className={`drawer-tab${tab.key === activeTab ? ' active' : ''}`}
                  onClick={() => onTabChange(tab.key)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="badge">{tab.badge}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="drawer-tab-body" role="tabpanel">{children}</div>
          </div>
        </div>
      </aside>
    </>
  );
}

/** Sol kolondaki künye satırı. */
export function SpecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="spec-row">
      <span className="spec-key">{label}</span>
      <span className="spec-val">{children ?? <span className="text-faint">—</span>}</span>
    </div>
  );
}
