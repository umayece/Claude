import { useState, type ReactElement } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { Avatar } from './Avatar';
import { RateWidget } from './RateWidget';
import { MkeStar } from './MkeStar';
import {
  IconAlert, IconArchive, IconBox, IconBuilding, IconCalendar, IconChart,
  IconFile, IconGavel, IconInbox, IconLogout, IconMap, IconMenu, IconNote,
  IconSettings, IconShield, IconSparkles, IconTrending, IconUsers, IconWrench, IconFlag,
} from './Icons';

interface NavEntry {
  to: string;
  label: string;
  icon: ReactElement;
  permission?: string;
}

interface NavGroup {
  title: string;
  items: NavEntry[];
}

const GROUPS: NavGroup[] = [
  {
    title: 'Genel',
    items: [
      { to: '/', label: 'Kontrol Paneli', icon: <IconChart size={17} /> },
      { to: '/map', label: 'Bölgesel Harita', icon: <IconMap size={17} />, permission: 'company:read' },
    ],
  },
  {
    title: 'Müşteri',
    items: [
      { to: '/companies', label: 'Şirketler', icon: <IconBuilding size={17} />, permission: 'company:read' },
      { to: '/contacts', label: 'Kişiler', icon: <IconUsers size={17} />, permission: 'contact:read' },
    ],
  },
  {
    title: 'Satış',
    items: [
      { to: '/deals', label: 'Fırsatlar', icon: <IconTrending size={17} />, permission: 'deal:read' },
      { to: '/offers', label: 'Teklifler', icon: <IconFile size={17} />, permission: 'offer:read' },
      { to: '/tenders', label: 'İhaleler', icon: <IconGavel size={17} />, permission: 'tender:read' },
      { to: '/contracts', label: 'Sözleşmeler', icon: <IconFile size={17} />, permission: 'contract:read' },
    ],
  },
  {
    title: 'Operasyon',
    items: [
      { to: '/tasks', label: 'Görevler & Takvim', icon: <IconCalendar size={17} />, permission: 'task:read' },
      { to: '/products', label: 'Ürün Kataloğu', icon: <IconBox size={17} />, permission: 'product:read' },
      { to: '/tickets', label: 'Destek & Garanti', icon: <IconWrench size={17} />, permission: 'ticket:read' },
      { to: '/notes', label: 'Notlarım', icon: <IconNote size={17} /> },
      { to: '/tags', label: 'Etiketler', icon: <IconArchive size={17} />, permission: 'company:read' },
      { to: '/outbox', label: 'Giden Kutusu', icon: <IconInbox size={17} />, permission: 'email:read' },
    ],
  },
  {
    title: 'Protokol & Arşiv',
    items: [
      { to: '/activities', label: 'Aktiviteler & Fuarlar', icon: <IconFlag size={17} />, permission: 'activity:read' },
      { to: '/protocol', label: 'Protokol & Heyet', icon: <IconShield size={17} />, permission: 'protocol:read' },
      { to: '/documents', label: 'Belge Deposu', icon: <IconArchive size={17} />, permission: 'document:read' },
    ],
  },
  {
    title: 'Akıllı',
    items: [
      { to: '/ai', label: 'AI Asistan & Lojistik', icon: <IconSparkles size={17} />, permission: 'ai:use' },
    ],
  },
  {
    title: 'Yönetim',
    items: [
      { to: '/trash', label: 'Çöp Kutusu', icon: <IconArchive size={17} />, permission: 'company:delete' },
      { to: '/audit', label: 'Denetim İzleri', icon: <IconShield size={17} />, permission: 'audit:read' },
      { to: '/settings', label: 'Ayarlar', icon: <IconSettings size={17} /> },
    ],
  },
];

export function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark" aria-hidden="true">MKE</div>
          <div className="sidebar-brand-text">
            <strong>MKE A.Ş.</strong>
            <span>Kurumsal CRM</span>
            <span className="sidebar-badge">Makina ve Kimya Endüstrisi</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {GROUPS.map((group) => {
            const visible = group.items.filter(
              (item) => !item.permission || can(item.permission),
            );
            if (visible.length === 0) return null;

            return (
              <div key={group.title}>
                <div className="sidebar-section">{group.title}</div>
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <RateWidget />
        </div>

        {/* MKE sekiz köşeli yıldız motifi — çok düşük opaklıkta doku. */}
        <MkeStar className="sidebar-watermark" size={210} />
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="Menüyü aç/kapat"
            style={{ display: 'none' }}
            data-mobile-toggle
          >
            <IconMenu size={18} />
          </button>

          <GlobalSearch />

          <div className="flex items-center gap-2 ml-auto">
            <NotificationBell />

            <div className="flex items-center gap-2" style={{ paddingLeft: 8 }}>
              <Avatar name={user?.name ?? '?'} src={user?.avatarUrl} size={30} />
              <div className="flex-col" style={{ lineHeight: 1.25 }}>
                <span className="text-sm font-semibold">{user?.name}</span>
                <span className="text-xs text-muted">{user?.role}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => void handleLogout()}
              aria-label="Çıkış yap"
              title="Çıkış yap"
            >
              <IconLogout size={17} />
            </button>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
