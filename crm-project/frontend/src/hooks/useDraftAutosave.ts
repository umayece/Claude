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

  /**
   * Bulunan ama HENÜZ UYGULANMAMIŞ taslak.
   *
   * Taslak otomatik yüklenmez: kullanıcı yeni bir kayıt açtığını sanırken
   * karşısına eski bir taslağın alanları çıkarsa bunu fark etmeyip yanlış
   * veriyi kaydedebilir. Karar kullanıcınındır.
   */
  pendingDraft: T | null;
  /** Bulunan taslağı forma uygular. */
  restoreDraft: () => void;
  /** Bulunan taslağı reddeder ve depodan siler. */
  discardDraft: () => void;
  /** Taslağın kaydedildiği zaman (bildirimde gösterilir). */
  pendingSavedAt: Date | null;
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

  // Form HER ZAMAN temiz başlar. Depodaki taslak ayrı tutulur ve
  // kullanıcı "Taslağı Yükle" derse uygulanır.
  const [draft, setDraftState] = useState<T>(initialValue);

  const [pendingDraft, setPendingDraft] = useState<T | null>(null);
  const [pendingSavedAt, setPendingSavedAt] = useState<Date | null>(null);

  const [status, setStatus] = useState<DraftStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);
  // İlk render'da (yalnızca yükleme) kaydetme tetiklenmemeli.
  const isFirstRun = useRef(true);

  // Açılışta depoyu tara: taslak varsa bildirim için hazırla.
  useEffect(() => {
    if (!enabled) {
      setPendingDraft(null);
      setHasRestoredDraft(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setPendingDraft(null);
        setHasRestoredDraft(false);
        return;
      }
      const parsed = JSON.parse(raw) as { value: T; savedAt: string };
      setPendingDraft(parsed.value);
      const savedAt = new Date(parsed.savedAt);
      setPendingSavedAt(Number.isNaN(savedAt.getTime()) ? null : savedAt);
      setHasRestoredDraft(true);
    } catch {
      // Bozuk JSON: taslak yok sayılır, form temiz açılır.
      setPendingDraft(null);
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

  const restoreDraft = useCallback(() => {
    if (pendingDraft === null) return;
    setDraftState(pendingDraft);
    setPendingDraft(null);
  }, [pendingDraft]);

  const discardDraft = useCallback(() => {
    setPendingDraft(null);
    setPendingSavedAt(null);
    setHasRestoredDraft(false);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Silinemezse bir sonraki kaydetme üzerine yazar.
    }
  }, [storageKey]);

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
    setPendingDraft(null);
    setPendingSavedAt(null);
  }, [storageKey]);

  return {
    draft, setDraft, status, lastSavedAt, clearDraft, hasRestoredDraft,
    pendingDraft, restoreDraft, discardDraft, pendingSavedAt,
  };
}
