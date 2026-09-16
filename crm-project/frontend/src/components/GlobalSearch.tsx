import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';
import type { SearchHit } from '../types';
import { IconSearch } from './Icons';

const TYPE_LABELS: Record<string, string> = {
  company: 'Şirketler',
  contact: 'Kişiler',
  deal: 'Fırsatlar',
  tender: 'İhaleler',
  contract: 'Sözleşmeler',
  offer: 'Teklifler',
  product: 'Ürünler',
  ticket: 'Destek Kayıtları',
};

export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const debounced = useDebounce(term, 300);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const response = await api.get<{ data: SearchHit[] }>(
          '/search', { q: debounced }, controller.signal,
        );
        setHits(response.data);
        setOpen(true);
        setHighlighted(0);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setHits([]);
      } finally {
        setLoading(false);
      }
    })();

    // Yeni arama başlarken önceki istek iptal edilir; yavaş bir yanıt
    // daha yeni sonuçların üstüne yazmasın.
    return () => controller.abort();
  }, [debounced]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.type) ?? [];
      list.push(hit);
      map.set(hit.type, list);
    }
    return [...map.entries()];
  }, [hits]);

  const go = (hit: SearchHit): void => {
    setOpen(false);
    setTerm('');
    navigate(hit.url);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const hit = hits[highlighted];
      if (hit) go(hit);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  let runningIndex = -1;

  return (
    <div className="global-search" ref={rootRef}>
      <IconSearch size={15} className="global-search-icon" />
      <input
        className="input global-search-input"
        placeholder="Şirket, kişi, telefon, ihale ara… (eski numaralar dahil)"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={() => { if (hits.length) setOpen(true); }}
        onKeyDown={onKeyDown}
        aria-label="Global arama"
      />

      {loading && (
        <span
          className="spinner"
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {open && (
        <div className="search-results">
          {hits.length === 0 && !loading && (
            <div className="dropdown-empty">"{debounced}" için sonuç bulunamadı.</div>
          )}

          {grouped.map(([type, items]) => (
            <div key={type}>
              <div className="search-group-label">{TYPE_LABELS[type] ?? type}</div>
              {items.map((hit) => {
                runningIndex += 1;
                const isHighlighted = runningIndex === highlighted;
                return (
                  <div
                    key={`${hit.type}-${hit.id}`}
                    className={`search-hit${isHighlighted ? ' highlighted' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => go(hit)}
                    onKeyDown={(event) => { if (event.key === 'Enter') go(hit); }}
                  >
                    <div className="search-hit-title">{hit.title}</div>
                    {hit.subtitle && <div className="search-hit-sub">{hit.subtitle}</div>}
                    {hit.matchReason && <div className="search-hit-reason">{hit.matchReason}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
