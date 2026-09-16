import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { MapView } from './components/MapView';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Companies } from './pages/Companies';
import { CompanyDetail } from './pages/CompanyDetail';
import { Contacts } from './pages/Contacts';
import { Deals } from './pages/Deals';
import { Offers } from './pages/Offers';
import { Tenders } from './pages/Tenders';
import { Contracts } from './pages/Contracts';
import { Products } from './pages/Products';
import { Tickets } from './pages/Tickets';
import { TasksCalendar } from './pages/TasksCalendar';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { AuditLogs } from './pages/AuditLogs';
import { Settings } from './pages/Settings';
import { Trash } from './pages/Trash';
import { EmailOutbox } from './pages/EmailOutbox';
import { StickyNotesBoard } from './pages/StickyNotesBoard';

function FullPageLoader() {
  return (
    <div className="loading-center" style={{ minHeight: '100vh' }}>
      <span className="spinner spinner-lg" />
      <span>Oturum doğrulanıyor…</span>
    </div>
  );
}

/** Yetkisiz kullanıcıyı girişe yönlendirir; MFA yarım kalmışsa oraya gönderir. */
function Protected({ children }: { children: ReactElement }) {
  const { user, initializing, mfaPending } = useAuth();
  const location = useLocation();

  if (initializing) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (mfaPending) return <Navigate to="/login" replace />;

  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="map" element={<MapView />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:id" element={<CompanyDetail />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<Contacts />} />
        <Route path="deals" element={<Deals />} />
        <Route path="deals/:id" element={<Deals />} />
        <Route path="offers" element={<Offers />} />
        <Route path="offers/:id" element={<Offers />} />
        <Route path="tenders" element={<Tenders />} />
        <Route path="tenders/:id" element={<Tenders />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="contracts/:id" element={<Contracts />} />
        <Route path="products" element={<Products />} />
        <Route path="products/:id" element={<Products />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="tickets/:id" element={<Tickets />} />
        <Route path="tasks" element={<TasksCalendar />} />
        <Route path="notes" element={<StickyNotesBoard />} />
        <Route path="outbox" element={<EmailOutbox />} />
        <Route path="ai" element={<AiAssistantPage />} />
        <Route path="trash" element={<Trash />} />
        <Route path="audit" element={<AuditLogs />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
