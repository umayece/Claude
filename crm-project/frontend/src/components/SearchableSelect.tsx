import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconSearch, IconX } from './Icons';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Uzaktan arama: yazılan metni dışarı verir (debounce çağıranın işi). */
  onSearch?: (term: string) => void;
  loading?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  emptyText?: string;
}

/**
 * Aranabilir seçici.
 *
 * KİLİTLENME HATASININ ÇÖZÜMÜ: panel bir modal/çekmece içindeyken dışa
 * tıklama dinleyicisi `mousedown` aşamasında ve YALNIZCA kendi kökü dışına
 * tıklandığında kapanır. Daha önce `click` aşamasında dinleyip olayı
 * durdurmayan uygulama, modalın kendi "dışa tıklayınca kapan" dinleyicisiyle
 * yarışıyor ve seçim yapılır yapılmaz form kilitleniyordu. Panel içindeki
 * tüm etkileşimler `stopPropagation` ile üst katmanlara sızdırılmaz.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Seçiniz...',
  onSearch,
  loading = false,
  disabled = false,
  clearable = true,
  id,
  emptyText = 'Sonuç bulunamadı.',
}: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const controlId = id ?? generatedId;

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  // Uzaktan arama varsa süzme sunucuda yapılır; yerelde tekrar süzmeyiz.
  const visible = useMemo(() => {
    if (onSearch || !term.trim()) return options;
    const needle = term.toLocaleLowerCase('tr');
    return options.filter(
      (option) =>
        option.label.toLocaleLowerCase('tr').includes(needle) ||
        (option.description?.toLocaleLowerCase('tr').includes(needle) ?? false),
    );
  }, [options, term, onSearch]);

  const close = useCallback(() => {
    setOpen(false);
    setTerm('');
    setHighlighted(0);
  }, []);

  // Dışa tıklama — `mousedown` kullanmak, tıklanan öğenin `click` olayı
  // tetiklenmeden önce kapanma kararının verilmesini sağlar.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const select = (optionValue: string): void => {
    onChange(optionValue);
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[highlighted];
      if (option) select(option.value);
    }
  };

  return (
    <div
      className={`searchable${open ? ' open' : ''}`}
      ref={rootRef}
      // Panel içindeki tıklamalar üst katmanlara (modal backdrop, satır
      // tıklaması) ulaşmamalı.
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="searchable-control"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${controlId}-listbox`}
        tabIndex={disabled ? -1 : 0}
        id={controlId}
        onClick={() => { if (!disabled) setOpen((prev) => !prev); }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
      >
        <span className={`searchable-value${selected ? '' : ' placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>

        {clearable && selected && !disabled && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 20, height: 20, padding: 0 }}
            aria-label="Seçimi temizle"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
              close();
            }}
          >
            <IconX size={13} />
          </button>
        )}
        <IconChevronDown size={15} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      </div>

      {open && (
        <div className="searchable-panel" id={`${controlId}-listbox`} role="listbox">
          <div className="searchable-search">
            <div style={{ position: 'relative' }}>
              <IconSearch
                size={14}
                style={{
                  position: 'absolute', left: 9, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--text-faint)',
                }}
              />
              <input
                ref={inputRef}
                className="input"
                style={{ paddingLeft: 30, fontSize: 13 }}
                placeholder="Ara..."
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setHighlighted(0);
                  onSearch?.(event.target.value);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>
          </div>

          <div className="searchable-options">
            {loading && <div className="searchable-empty"><span className="spinner" /></div>}

            {!loading && visible.length === 0 && (
              <div className="searchable-empty">{emptyText}</div>
            )}

            {!loading &&
              visible.map((option, index) => (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={
                    'searchable-option' +
                    (option.value === value ? ' selected' : '') +
                    (index === highlighted ? ' highlighted' : '')
                  }
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => select(option.value)}
                >
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
