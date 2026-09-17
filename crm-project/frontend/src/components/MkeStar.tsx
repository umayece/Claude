/**
 * MKE sekiz köşeli Türk Yıldızı motifi (çift çeperli).
 *
 * Marka kimlik kılavuzundaki geometrik doku. Arka plan filigranı olarak
 * çok düşük opaklıkta kullanılır; `aria-hidden` çünkü dekoratiftir ve
 * ekran okuyucuya bir anlam taşımaz.
 *
 * Geometri: iki kare üst üste 45° döndürülerek sekiz köşeli yıldız
 * (Selçuklu yıldızı) elde edilir. Çift çeper, aynı yıldızın ölçeklenmiş
 * bir kopyasıyla verilir.
 */
interface Props {
  size?: number;
  className?: string;
  /** Dolgu yerine yalnızca çizgi (kontur) kullan. */
  outline?: boolean;
  color?: string;
}

/** Merkezi (50,50) olan, verilen yarıçapta sekiz köşeli yıldız yolu. */
function starPoints(radius: number): string {
  const center = 50;
  const points: string[] = [];

  // Sekiz köşeli yıldız: 16 nokta, dış ve iç yarıçap dönüşümlü.
  const inner = radius * 0.62;
  for (let i = 0; i < 16; i += 1) {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const r = i % 2 === 0 ? radius : inner;
    points.push(`${(center + r * Math.cos(angle)).toFixed(2)},${(center + r * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

export function MkeStar({ size = 200, className, outline = true, color = 'currentColor' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Dış çeper */}
      <polygon
        points={starPoints(46)}
        fill={outline ? 'none' : color}
        stroke={color}
        strokeWidth={outline ? 1.6 : 0}
        strokeLinejoin="round"
      />
      {/* İç çeper — çift çeperli görünümü veren ikinci yıldız */}
      <polygon
        points={starPoints(33)}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {/* Merkez sekizgen */}
      <polygon
        points={starPoints(14)}
        fill={outline ? 'none' : color}
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
