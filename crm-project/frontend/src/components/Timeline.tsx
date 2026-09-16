import type { Activity } from '../types';
import {
  IconGavel, IconMail, IconNote, IconPhone, IconTrending, IconWhatsapp, IconWrench,
} from './Icons';

function iconFor(type: string) {
  switch (type) {
    case 'EMAIL': return { node: <IconMail size={11} />, cls: 'email' };
    case 'CALL': return { node: <IconPhone size={11} />, cls: 'call' };
    case 'WHATSAPP': return { node: <IconWhatsapp size={11} />, cls: 'whatsapp' };
    case 'STAGE_CHANGE': return { node: <IconTrending size={11} />, cls: 'stage' };
    case 'TICKET': return { node: <IconWrench size={11} />, cls: 'ticket' };
    case 'NOTE': return { node: <IconNote size={11} />, cls: '' };
    default: return { node: <IconGavel size={11} />, cls: '' };
  }
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (diffMinutes < 1) return 'az önce';
  if (diffMinutes < 60) return `${diffMinutes} dk önce`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)} saat önce`;
  if (diffMinutes < 10080) return `${Math.round(diffMinutes / 1440)} gün önce`;

  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Props {
  activities: Activity[];
  emptyText?: string;
}

export function Timeline({ activities, emptyText = 'Henüz bir etkileşim kaydı yok.' }: Props) {
  if (activities.length === 0) {
    return <div className="empty-state" style={{ padding: 28 }}><p>{emptyText}</p></div>;
  }

  return (
    <div className="timeline">
      {activities.map((activity) => {
        const icon = iconFor(activity.type);
        return (
          <div className="timeline-item" key={activity.id}>
            <div className={`timeline-dot ${icon.cls}`}>{icon.node}</div>

            <div className="timeline-head">
              <span className="timeline-title">{activity.title}</span>
              <span className="timeline-meta">
                {formatWhen(activity.createdAt)}
                {activity.user && ` · ${activity.user.name}`}
              </span>
            </div>

            {activity.body && (
              <div className="timeline-body">
                {activity.body.length > 600
                  ? `${activity.body.slice(0, 600)}…`
                  : activity.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
