import { useState } from 'react';

interface Props {
  stages: readonly string[];
  current: string;
  onChange: (stage: string) => Promise<void> | void;
  disabled?: boolean;
  /** Bu aşamalar "kayıp" olarak kırmızı boyanır. */
  lostStages?: readonly string[];
  /** Bu aşamalar "kazanıldı" olarak yeşil boyanır. */
  wonStages?: readonly string[];
}

/**
 * Bitrix24 tarzı chevron süreç çubuğu.
 *
 * Aşamaya tıklandığında iyimser güncelleme yapılmaz: sunucu yanıtı
 * beklenir ve o süre boyunca çubuk kilitlenir. Aksi halde başarısız bir
 * `PUT /stage` isteğinden sonra ekranda yanlış aşama görünür.
 */
export function PipelineBar({
  stages,
  current,
  onChange,
  disabled = false,
  lostStages = ['Kaybedildi', 'İptal'],
  wonStages = ['Kazanıldı'],
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const currentIndex = stages.indexOf(current);

  const handleClick = async (stage: string): Promise<void> => {
    if (disabled || pending || stage === current) return;
    setPending(stage);
    try {
      await onChange(stage);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="pipeline" role="group" aria-label="Süreç aşamaları">
      {stages.map((stage, index) => {
        const isActive = stage === current;
        const isDone = currentIndex >= 0 && index < currentIndex;
        const isLost = isActive && lostStages.includes(stage);
        const isWon = isActive && wonStages.includes(stage);

        const className = [
          'pipeline-step',
          isWon ? 'won' : isLost ? 'lost' : isActive ? 'active' : isDone ? 'done' : '',
        ].filter(Boolean).join(' ');

        return (
          <button
            key={stage}
            type="button"
            className={className}
            disabled={disabled || pending !== null}
            aria-current={isActive ? 'step' : undefined}
            title={stage}
            onClick={() => void handleClick(stage)}
          >
            {pending === stage ? <span className="spinner" style={{ width: 12, height: 12 }} /> : stage}
          </button>
        );
      })}
    </div>
  );
}
