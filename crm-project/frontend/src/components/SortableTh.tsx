import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { IconChevronDown } from './Icons';

/**
 * Üç durumlu (tri-state) tablo sıralaması.
 *
 * Döngü: artan → azalan → VARSAYILAN. Üçüncü tıklama sıralamayı kaldırır
 * ve liste sunucunun doğal sırasına (kayıt kimliği / oluşturma zamanı)
 * döner. İki durumlu sıralamada kullanıcı "sırasız hâle" bir daha asla
 * dönemez; sayfayı yenilemek zorunda kalır.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: string;
  direction: SortDirection;
}

/**
 * Sıralama durumunu yöneten kanca.
 *
 * `null` = varsayılan sıra. `toQuery` sunucuya gönderilecek `sort`
 * parametresini üretir (`"amount:desc"`); varsayılanda `undefined` döner
 * ki istek parametresi hiç eklenmesin.
 */
export function useTriStateSort(initial: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initial);

  const toggle = useCallback((field: string) => {
    setSort((prev) => {
      // Başka bir kolona geçildi: yeni kolon artan başlar.
      if (!prev || prev.field !== field) return { field, direction: 'asc' };
      if (prev.direction === 'asc') return { field, direction: 'desc' };
      // Üçüncü tıklama: varsayılana dön.
      return null;
    });
  }, []);

  /**
   * Sunucu sözleşmesi: `parseSort` azalan sıra için `-` öneki bekler
   * (`"-amount"`), artan için çıplak alan adı (`"amount"`). Varsayılan
   * durumda `undefined` döner ki istek parametresi hiç eklenmesin ve
   * sunucu kendi doğal sırasını uygulasın.
   */
  const toQuery = useCallback(
    (): string | undefined => {
      if (!sort) return undefined;
      return sort.direction === 'desc' ? `-${sort.field}` : sort.field;
    },
    [sort],
  );

  return { sort, setSort, toggle, toQuery };
}

interface Props {
  /** Sunucudaki alan adı (`sort` parametresine gider). */
  field: string;
  sort: SortState | null;
  onToggle: (field: string) => void;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Sıralanamayan kolonlar için: başlık düz metin olarak basılır. */
  disabled?: boolean;
}

/** Sıralama okunu çizer: aktif kolonda belirgin, diğerlerinde soluk. */
function SortIcon({ state }: { state: 'asc' | 'desc' | 'none' }) {
  if (state === 'none') {
    // Soluk çift ok: "bu kolon sıralanabilir" ipucu.
    return <span className="sort-icon is-idle" aria-hidden="true">↕</span>;
  }
  return (
    <span className={`sort-icon is-active ${state}`} aria-hidden="true">
      <IconChevronDown size={12} />
    </span>
  );
}

export function SortableTh({
  field, sort, onToggle, children, align = 'left', className, disabled = false,
}: Props) {
  if (disabled) {
    return <th className={className} style={{ textAlign: align }}>{children}</th>;
  }

  const state: 'asc' | 'desc' | 'none' =
    sort?.field === field ? sort.direction : 'none';

  // Ekran okuyucu için sıralama durumu: tablo başlığının ARIA sözleşmesi.
  const ariaSort = state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none';

  const label = state === 'none'
    ? 'artan sırala'
    : state === 'asc' ? 'azalan sırala' : 'sıralamayı kaldır';

  return (
    <th className={className} aria-sort={ariaSort} style={{ textAlign: align }}>
      <button
        type="button"
        className={`sort-th${state !== 'none' ? ' is-sorted' : ''}`}
        style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
        onClick={() => onToggle(field)}
        title={`${typeof children === 'string' ? children : 'Kolon'} — ${label}`}
      >
        <span>{children}</span>
        <SortIcon state={state} />
      </button>
    </th>
  );
}
