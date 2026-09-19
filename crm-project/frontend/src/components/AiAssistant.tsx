import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamSse } from '../api/client';
import {
  IconAlert, IconCopy, IconNote, IconSparkles, IconStop,
} from './Icons';

export type AiTask = 'COMPANY_SUMMARY' | 'TENDER_RISK' | 'FREEFORM';

interface Props {
  task: AiTask;
  /** COMPANY_SUMMARY → şirket kimliği, TENDER_RISK → ihale kimliği. */
  entityId?: string;
  /** FREEFORM görevlerde sorulacak metin. */
  question?: string;
  /** Bileşen görünür olduğunda akışı kendiliğinden başlat. */
  autoStart?: boolean;
  /** Sonucu zaman tüneline kaydetme düğmesi için bağlam. */
  saveContext?: { companyId?: string | null; tenderId?: string | null };
  onComplete?: (text: string) => void;
}

interface StreamMeta {
  title: string;
  contextSummary: string;
  model: string;
}

/**
 * AI asistan paneli.
 *
 * Akış token bazlıdır: her `token` olayı geldiğinde metin durumu büyür ve
 * React yeniden render eder. Token'lar tek tek `setState` çağırmak yerine
 * bir tamponda biriktirilip animasyon karesi başına bir kez yazılır —
 * saniyede yüzlerce token geldiğinde her token için render etmek arayüzü
 * kilitler.
 */
export function AiAssistant({
  task, entityId, question, autoStart = false, saveContext, onComplete,
}: Props) {
  const [text, setText] = useState('');
  const [meta, setMeta] = useState<StreamMeta | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const frameRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const textRef = useRef('');
  // Kullanıcı yukarı kaydırdıysa otomatik takip durur.
  const followRef = useRef(true);

  const flush = useCallback(() => {
    frameRef.current = null;
    if (!bufferRef.current) return;
    const chunk = bufferRef.current;
    bufferRef.current = '';
    textRef.current += chunk;
    setText(textRef.current);
  }, []);

  const pushToken = useCallback(
    (token: string) => {
      bufferRef.current += token;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreaming(false);
  }, []);

  const start = useCallback(async () => {
    if (streaming) return;

    // Önceki akış varsa kapat; iki akış aynı metne yazmamalı.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    bufferRef.current = '';
    textRef.current = '';
    followRef.current = true;
    setText('');
    setMeta(null);
    setError(null);
    setSaved(false);
    setStreaming(true);

    try {
      await streamSse(
        '/ai/stream',
        { task, entityId, question },
        {
          onMeta: (data) => setMeta(data),
          onToken: pushToken,
          onDone: () => {
            flush();
            setStreaming(false);
            onComplete?.(textRef.current);
          },
          onError: (message) => {
            flush();
            setError(message);
            setStreaming(false);
          },
        },
        controller.signal,
      );
    } catch {
      // Hata zaten onError ile bildirildi; burada yalnızca durum sıfırlanır.
      setStreaming(false);
    } finally {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      flush();
      controllerRef.current = null;
    }
  }, [streaming, task, entityId, question, pushToken, flush, onComplete]);

  // Otomatik başlatma — hedef kayıt değişirse yeniden çalışır.
  useEffect(() => {
    if (!autoStart) return;
    void start();
    // `start` her render'da yeniden üretilebileceğinden bağımlılık listesine
    // alınmaz; tetikleyici yalnızca görev ve hedef kaydın değişmesidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, task, entityId]);

  // Bileşen ayrılırken açık akış bırakılmaz.
  useEffect(() => () => {
    controllerRef.current?.abort();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // Akış sürerken en alta yapış.
  useEffect(() => {
    const element = outputRef.current;
    if (!element || !followRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [text]);

  const handleScroll = (): void => {
    const element = outputRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    followRef.current = distance < 40;
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Panoya kopyalanamadı.');
    }
  };

  const saveToTimeline = async (): Promise<void> => {
    if (!text.trim()) return;
    try {
      await api.post('/ai/save-to-timeline', {
        companyId: saveContext?.companyId ?? null,
        tenderId: saveContext?.tenderId ?? null,
        title: meta?.title ?? 'AI Analizi',
        content: text,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zaman tüneline kaydedilemedi.');
    }
  };

  const buttonLabel = useMemo(() => {
    switch (task) {
      case 'COMPANY_SUMMARY': return 'Şirket Geçmişini Özetle';
      case 'TENDER_RISK': return 'Şartname Risk Analizi';
      default: return 'Yanıtla';
    }
  }, [task]);

  return (
    <div className="ai-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void start()}
          disabled={streaming || (task === 'FREEFORM' && !question?.trim())}
        >
          <IconSparkles size={15} />
          {streaming ? 'Üretiliyor…' : text ? 'Yeniden Çalıştır' : buttonLabel}
        </button>

        {streaming && (
          <button type="button" className="btn btn-sm" onClick={stop}>
            <IconStop size={13} /> Durdur
          </button>
        )}

        {text && !streaming && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>
              <IconCopy size={13} /> {copied ? 'Kopyalandı' : 'Kopyala'}
            </button>
            {saveContext && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void saveToTimeline()}
                disabled={saved}
              >
                <IconNote size={13} /> {saved ? 'Kaydedildi' : 'Zaman Tüneline Kaydet'}
              </button>
            )}
          </>
        )}
      </div>

      {meta && (
        <div className="ai-meta">
          <strong>{meta.title}</strong>
          <span>·</span>
          <span>Bağlam: {meta.contextSummary}</span>
          <span>·</span>
          <span className="mono">{meta.model}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 0 }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      {(text || streaming) && (
        <div
          className="ai-output"
          ref={outputRef}
          onScroll={handleScroll}
          style={{ maxHeight: 460, overflowY: 'auto' }}
          aria-live="polite"
          aria-busy={streaming}
        >
          <FormattedAiText text={text} />
          {streaming && <span className="ai-cursor" />}
        </div>
      )}

      {!text && !streaming && !error && (
        <div className="empty-state" style={{ padding: '32px 16px' }}>
          <IconSparkles size={34} />
          <h3>AI Analizi Hazır</h3>
          <p>
            {task === 'TENDER_RISK'
              ? 'Şartname ve CRM geçmişine dayalı risk analizi için düğmeye basın.'
              : task === 'COMPANY_SUMMARY'
                ? 'Şirketin tüm CRM geçmişini tek ekranda özetlemek için düğmeye basın.'
                : 'Sorunuzu yazıp yanıtlayın.'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Akış metnini hafifçe biçimlendirir.
 *
 * Tam bir Markdown ayrıştırıcısı bilinçli olarak kullanılmaz: model
 * çıktısı `dangerouslySetInnerHTML` ile basılırsa XSS yüzeyi doğar.
 * Burada metin React düğümleri olarak üretilir, yani asla HTML olarak
 * yorumlanmaz.
 */
function FormattedAiText({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split('\n');
    return lines.map((line, index) => {
      const key = `${index}-${line.slice(0, 12)}`;

      // "### Başlık" veya "**Başlık**" satırı
      const headingMatch = /^#{1,4}\s+(.*)$/.exec(line) ?? /^\*\*(.+)\*\*:?\s*$/.exec(line);
      if (headingMatch?.[1]) {
        return <h3 key={key}>{headingMatch[1].replace(/\*\*/g, '')}</h3>;
      }

      if (line.trim() === '') return <br key={key} />;

      // "1. Adım" — numaralı aksiyon adımı
      const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line.trim());
      if (numbered?.[1] && numbered[2]) {
        return (
          <div key={key} className="ai-step">
            <span className="ai-step-no">{numbered[1]}</span>
            <span className="ai-step-body"><RiskAwareLine line={numbered[2]} /></span>
          </div>
        );
      }

      // "- madde" — tonuna göre renklenen madde işareti
      const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
      if (bullet?.[1]) {
        const body = bullet[1];
        const tone = bulletTone(body);
        return (
          <div key={key} className={`ai-bullet ${tone}`}>
            <span className="ai-bullet-dot" aria-hidden="true" />
            <span className="ai-bullet-body"><RiskAwareLine line={body} /></span>
          </div>
        );
      }

      return (
        <div key={key}>
          <RiskAwareLine line={line} />
        </div>
      );
    });
  }, [text]);

  return <>{blocks}</>;
}

/**
 * Madde işaretinin tonunu metinden çıkarır.
 *
 * Kuru bir liste yerine riskler kırmızı, fırsatlar yeşil görünür. Eşleşme
 * anahtar kelimeye dayalı ve kasıtlı olarak basittir; tanımadığı satırı
 * nötr bırakır — yanlış renklendirmektense renksiz bırakmak yeğdir.
 */
function bulletTone(text: string): 'is-risk' | 'is-good' | 'is-warn' | '' {
  const lower = text.toLocaleLowerCase('tr');
  if (/gecikt|kayb|risk|reddedil|engel|iptal|eksik|uyar|kritik|süresi doldu/.test(lower)) {
    return 'is-risk';
  }
  if (/kazanıl|onayland|tamamland|artış|fırsat|başarı|hazır|sıcak/.test(lower)) {
    return 'is-good';
  }
  if (/bekliyor|beklemede|yaklaş|inceleniyor|takip/.test(lower)) return 'is-warn';
  return '';
}

/** [YÜKSEK] / [ORTA] / [DÜŞÜK] risk etiketlerini renklendirir. */
function RiskAwareLine({ line }: { line: string }) {
  const parts = useMemo(() => line.split(/(\[(?:YÜKSEK|ORTA|DÜŞÜK)\])/g), [line]);

  return (
    <>
      {parts.map((part, index) => {
        const key = `${index}-${part.slice(0, 8)}`;
        if (part === '[YÜKSEK]') return <span key={key} className="ai-risk-high">{part}</span>;
        if (part === '[ORTA]') return <span key={key} className="ai-risk-mid">{part}</span>;
        if (part === '[DÜŞÜK]') return <span key={key} className="ai-risk-low">{part}</span>;
        // Kalın vurguları düz metne indir: yıldızlar ekranda görünmesin.
        return <span key={key}>{part.replace(/\*\*/g, '')}</span>;
      })}
    </>
  );
}
