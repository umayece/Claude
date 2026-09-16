import { useCallback, useEffect, useRef, useState } from 'react';

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseDraftAutosave<T> {
  draft: T;
  setDraft: (value: T | ((prev: T) => T)) => void;
  status: DraftStatus;
  lastSavedAt: Date | null;
  /** Kaydedilmiş taslağı siler (form gönderildikten sonra çağrılır). */
  clearDraft: () => void;
  hasRestoredDraft: boolean;
}

/**
 * Form taslağını yerel depolamaya otomatik kaydeder.
 *
 * Uzun formlarda (teklif, ihale şartnamesi) sekme kapanırsa veri kaybını
 * önler. Kaydetme gecikmeli (debounce) yapılır; her tuş vuruşunda
 * serileştirme maliyeti ödenmez.
 */
export function useDraftAutosave<T>(
  key: string,
  initialValue: T,
  options: { delayMs?: number; enabled?: boolean } = {},
): UseDraftAutosave<T> {
  const { delayMs = 800, enabled = true } = options;
  const storageKey = `crm:draft:${key}`;

  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [draft, setDraftState] = useState<T>(() => {
    if (!enabled) return initialValue;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return initialValue;
      const parsed = JSON.parse(raw) as { value: T; savedAt: string };
      return parsed.value;
    } catch {
      return initialValue;
    }
  });

  const [status, setStatus] = useState<DraftStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);
  // İlk render'da (yalnızca yükleme) kaydetme tetiklenmemeli.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    try {
      setHasRestoredDraft(window.localStorage.getItem(storageKey) !== null);
    } catch {
      setHasRestoredDraft(false);
    }
  }, [storageKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    setStatus('saving');
    if (timer.current !== null) window.clearTimeout(timer.current);

    timer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ value: draft, savedAt: new Date().toISOString() }),
        );
        setLastSavedAt(new Date());
        setStatus('saved');
      } catch {
        // Kota dolduğunda kullanıcı uyarılır ama form çalışmaya devam eder.
        setStatus('error');
      }
    }, delayMs);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [draft, storageKey, delayMs, enabled]);

  const setDraft = useCallback((value: T | ((prev: T) => T)) => {
    setDraftState((prev) => (typeof value === 'function' ? (value as (p: T) => T)(prev) : value));
  }, []);

  const clearDraft = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Silinemezse bir sonraki kaydetme üzerine yazar.
    }
    setStatus('idle');
    setLastSavedAt(null);
    setHasRestoredDraft(false);
  }, [storageKey]);

  return { draft, setDraft, status, lastSavedAt, clearDraft, hasRestoredDraft };
}
