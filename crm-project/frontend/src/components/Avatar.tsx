interface Props {
  name: string;
  src?: string | null;
  size?: number;
}

/** Fotoğraf varsa gösterir; yoksa baş harflerden bir yedek üretir. */
export function Avatar({ name, src, size = 32 }: Props) {
  if (src) {
    return (
      <img
        className="avatar"
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr'))
    .join('');

  return (
    <div
      className="avatar-fallback"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden="true"
    >
      {initials || '?'}
    </div>
  );
}
