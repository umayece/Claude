import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';
import { AiAssistant, type AiTask } from '../components/AiAssistant';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { IconAlert, IconSparkles } from '../components/Icons';
import type { Company, Paginated, Tender } from '../types';

interface AiStatus {
  modelConfigured: boolean;
  model: string;
  tasks: string[];
  streaming: boolean;
}

const TASK_OPTIONS: { value: AiTask; label: string; description: string }[] = [
  {
    value: 'COMPANY_SUMMARY',
    label: 'Şirket Geçmişi Özeti',
    description: 'Seçilen kurumun tüm CRM geçmişini yönetici brifingi olarak özetler.',
  },
  {
    value: 'TENDER_RISK',
    label: 'İhale Şartname Risk Analizi',
    description: 'Şartname metnini ve geçmiş ihaleleri risk başlıklarına ayırır.',
  },
  {
    value: 'FREEFORM',
    label: 'Serbest Soru',
    description: 'CRM verisi hakkında serbest metin sorusu sorun.',
  },
];

export function AiAssistantPage() {
  const [task, setTask] = useState<AiTask>('COMPANY_SUMMARY');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tenderId, setTenderId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');

  const [status, setStatus] = useState<AiStatus | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [companyTerm, setCompanyTerm] = useState('');
  const [tenderTerm, setTenderTerm] = useState('');

  const debouncedCompanyTerm = useDebounce(companyTerm, 300);
  const debouncedTenderTerm = useDebounce(tenderTerm, 300);

  useEffect(() => {
    void (async () => {
      try {
        setStatus(await api.get<AiStatus>('/ai/status'));
      } catch {
        setStatus(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (task !== 'COMPANY_SUMMARY') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<Paginated<Company>>(
          '/companies', { q: debouncedCompanyTerm || undefined, pageSize: 30 }, controller.signal,
        );
        setCompanies(response.data);
      } catch {
        // Arama başarısız olsa da sayfa çalışır.
      }
    })();
    return () => controller.abort();
  }, [task, debouncedCompanyTerm]);

  useEffect(() => {
    if (task !== 'TENDER_RISK') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<Paginated<Tender>>(
          '/tenders', { q: debouncedTenderTerm || undefined, pageSize: 30 }, controller.signal,
        );
        setTenders(response.data);
      } catch {
        // Yardımcı liste.
      }
    })();
    return () => controller.abort();
  }, [task, debouncedTenderTerm]);

  const companyOptions: SelectOption[] = useMemo(
    () => companies.map((company) => ({
      value: company.id, label: company.name,
      description: [company.type, company.city?.name].filter(Boolean).join(' · '),
    })),
    [companies],
  );

  const tenderOptions: SelectOption[] = useMemo(
    () => tenders.map((tender) => ({
      value: tender.id,
      label: `${tender.tenderNumber} — ${tender.title}`,
      description: tender.hasSpecification ? 'Şartname yüklü' : 'Şartname yok',
    })),
    [tenders],
  );

  const entityId = task === 'TENDER_RISK' ? tenderId ?? undefined
    : task === 'COMPANY_SUMMARY' ? companyId ?? undefined
    : undefined;

  const selectedTender = tenders.find((tender) => tender.id === tenderId);
  const ready = task === 'FREEFORM' ? question.trim().length > 0 : Boolean(entityId);

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1><IconSparkles size={19} /> AI Asistan</h1>
          <p>Şirket geçmişi özeti ve ihale şartnamesi risk analizi.</p>
        </div>
      </div>

      {status && !status.modelConfigured && (
        <div className="alert alert-warning">
          <IconAlert size={16} />
          <div>
            <strong>Yerel özet motoru etkin.</strong> Sunucuda <code className="mono">ANTHROPIC_API_KEY</code>
            {' '}tanımlı olmadığı için hiçbir müşteri verisi dışarıya gönderilmiyor.
            Çıktı doğrudan CRM kayıtlarından üretiliyor. Model tabanlı analiz için
            sistem yöneticinizle iletişime geçin.
          </div>
        </div>
      )}

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h2>Analiz Türü</h2></div>
          <div className="card-body">
            {TASK_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="checkbox-row mb-3"
                style={{ alignItems: 'flex-start' }}
              >
                <input
                  type="radio" name="ai-task" value={option.value}
                  checked={task === option.value}
                  onChange={() => setTask(option.value)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span className="font-semibold">{option.label}</span>
                  <br />
                  <span className="text-xs text-muted">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>Hedef</h2></div>
          <div className="card-body">
            {task === 'COMPANY_SUMMARY' && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="ai-company">Şirket</label>
                <SearchableSelect
                  id="ai-company"
                  options={companyOptions}
                  value={companyId}
                  onChange={setCompanyId}
                  onSearch={setCompanyTerm}
                  placeholder="Şirket seçiniz…"
                />
              </div>
            )}

            {task === 'TENDER_RISK' && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="ai-tender">İhale</label>
                <SearchableSelect
                  id="ai-tender"
                  options={tenderOptions}
                  value={tenderId}
                  onChange={setTenderId}
                  onSearch={setTenderTerm}
                  placeholder="İhale seçiniz…"
                />
                {selectedTender && !selectedTender.hasSpecification && (
                  <div className="field-hint" style={{ color: 'var(--warning)' }}>
                    Bu ihaleye şartname yüklenmemiş; analiz künye verisiyle sınırlı olacak.
                  </div>
                )}
              </div>
            )}

            {task === 'FREEFORM' && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="ai-question">Sorunuz</label>
                <textarea
                  id="ai-question" className="textarea" rows={6} value={question}
                  placeholder="Örn: Savunma sektöründeki müşterilerimizde en sık görülen kayıp nedeni nedir?"
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={8000}
                />
                <div className="field-hint">{question.length} / 8000 karakter</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Sonuç</h2>
          {status && (
            <span className="text-sm text-muted mono">
              {status.model}{status.streaming ? ' · akış açık' : ''}
            </span>
          )}
        </div>

        <div className="card-body">
          {ready ? (
            <AiAssistant
              // `key` hedefe bağlıdır: hedef değişince bileşen sıfırdan
              // kurulur ve önceki analizin metni ekranda kalmaz.
              key={`${task}-${entityId ?? question.slice(0, 24)}`}
              task={task}
              entityId={entityId}
              question={task === 'FREEFORM' ? question : undefined}
              saveContext={
                task === 'TENDER_RISK'
                  ? { tenderId }
                  : task === 'COMPANY_SUMMARY'
                    ? { companyId }
                    : undefined
              }
            />
          ) : (
            <div className="empty-state" style={{ padding: 32 }}>
              <IconSparkles size={36} />
              <h3>Hedef seçin</h3>
              <p>
                {task === 'FREEFORM'
                  ? 'Sorunuzu yazdıktan sonra analiz başlatılabilir.'
                  : 'Analiz için yukarıdan bir kayıt seçin.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
