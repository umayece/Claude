import { IconChevronLeft, IconChevronRight } from './Icons';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export function Pagination({
  page, pageSize, total, totalPages, onPageChange, onPageSizeChange,
}: Props) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <span className="pagination-info">
        {total === 0
          ? 'Kayıt yok'
          : `${first.toLocaleString('tr-TR')}–${last.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} kayıt`}
      </span>

      <div className="pagination-controls">
        {onPageSizeChange && (
          <select
            className="select"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 12.5 }}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Sayfa başına kayıt"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>{size} / sayfa</option>
            ))}
          </select>
        )}

        <button
          type="button" className="btn btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Önceki sayfa"
        >
          <IconChevronLeft size={14} />
        </button>

        <span className="text-sm text-muted nowrap" style={{ padding: '0 6px' }}>
          {page} / {Math.max(1, totalPages)}
        </span>

        <button
          type="button" className="btn btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Sonraki sayfa"
        >
          <IconChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
