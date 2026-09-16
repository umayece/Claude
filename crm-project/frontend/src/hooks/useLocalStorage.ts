import { useCallback, useEffect, useState } from 'react';

/**
 * Kalıcı yerel durum.
 *
 * Gizli sekme veya kapalı site verisi durumunda okuma/yazma istisna
 * fırlatabilir; her erişim try/catch ile korunur ve depolama çalışmasa da
 * bileşen doğru render eder.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStored((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Kota dolu veya depolama kapalı — durum bellekte yaşamaya devam eder.
        }
        return next;
      });
    },
    [key],
  );

  // Aynı anahtarı başka bir sekme değiştirirse senkron kal.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== key || event.newValue === null) return;
      try {
        setStored(JSON.parse(event.newValue) as T);
      } catch {
        // Bozuk değer yok sayılır.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [stored, setValue];
}
