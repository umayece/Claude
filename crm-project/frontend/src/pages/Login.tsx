import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { IconShield } from '../components/Icons';

export function Login() {
  const { user, mfaPending, initializing, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (initializing) {
    return (
      <div className="login-shell">
        <span className="spinner spinner-lg" style={{ borderTopColor: '#38bdf8' }} />
      </div>
    );
  }

  if (user && !mfaPending) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const submitCredentials = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email.trim().toLowerCase(), password);
      if (!result.mfaRequired) navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş yapılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(code.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Doğrulama başarısız.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">MKE</div>
          <h1>MKE A.Ş. CRM</h1>
          <p className="text-sm text-muted">Kurumsal Müşteri İlişkileri Yönetimi</p>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {mfaPending ? (
          <form onSubmit={(event) => void submitMfa(event)}>
            <div className="alert alert-info">
              <IconShield size={16} />
              <span>İki adımlı doğrulama etkin. Uygulamanızdaki 6 haneli kodu girin.</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="mfa-code">Doğrulama Kodu</label>
              <input
                id="mfa-code"
                className="input mono"
                style={{ fontSize: 20, letterSpacing: 6, textAlign: 'center' }}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^0-9A-Za-z-]/g, ''))}
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                maxLength={20}
              />
              <div className="field-hint">
                Uygulamanıza erişemiyorsanız kurtarma kodlarınızdan birini girebilirsiniz.
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={busy || code.length < 6}>
              {busy ? <span className="spinner" /> : null} Doğrula
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void submitCredentials(event)}>
            <div className="field">
              <label className="field-label" htmlFor="login-email">E-Posta</label>
              <input
                id="login-email" className="input" type="email" value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username" required autoFocus
                placeholder="ad.soyad@mke.gov.tr"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="login-password">Şifre</label>
              <input
                id="login-password" className="input" type="password" value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password" required
              />
            </div>

            <button
              type="submit" className="btn btn-primary w-full"
              disabled={busy || !email || !password}
            >
              {busy ? <span className="spinner" /> : null} Giriş Yap
            </button>
          </form>
        )}

        <p className="text-xs text-muted text-center mt-4" style={{ marginBottom: 0 }}>
          Yetkisiz erişim girişimleri kayıt altına alınır.
        </p>
      </div>
    </div>
  );
}
