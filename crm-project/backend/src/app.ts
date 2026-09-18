import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './lib/env';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import authRoutes from './routes/auth.routes';
import mfaRoutes from './routes/mfa.routes';
import companiesRoutes from './routes/companies.routes';
import contactsRoutes from './routes/contacts.routes';
import dealsRoutes from './routes/deals.routes';
import offersRoutes from './routes/offers.routes';
import tendersRoutes from './routes/tenders.routes';
import contractsRoutes from './routes/contracts.routes';
import productsRoutes from './routes/products.routes';
import ticketsRoutes from './routes/tickets.routes';
import tasksRoutes from './routes/tasks.routes';
import calendarRoutes from './routes/calendar.routes';
import emailRoutes from './routes/email.routes';
import searchRoutes from './routes/search.routes';
import aiRoutes from './routes/ai.routes';
import auditRoutes from './routes/audit.routes';
import exchangeRatesRoutes from './routes/exchangeRates.routes';
import citiesRoutes from './routes/cities.routes';
import customFieldsRoutes from './routes/customFields.routes';
import dashboardRoutes from './routes/dashboard.routes';
import usersRoutes from './routes/users.routes';
import notesRoutes from './routes/notes.routes';
import systemRoutes from './routes/system.routes';
import protocolRoutes from './routes/protocol.routes';
import documentsRoutes from './routes/documents.routes';
import activitiesRoutes from './routes/activities.routes';
import notificationsRoutes from './routes/notifications.routes';

export function createApp(): Express {
  const app = express();

  // Ters vekil arkasında doğru istemci IP'si — hız sınırlarının
  // doğru anahtarlanması buna bağlıdır.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // API yalnızca JSON döndürür; CSP'yi frontend'in Nginx katmanı yönetir.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Origin taşımayan istekler (curl, sunucu-sunucu) engellenmez;
        // tarayıcı kaynaklı isteklerde beyaz liste uygulanır.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS politikası bu kaynağa izin vermiyor.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(
    compression({
      // SSE akışını sıkıştırma tamponlaması bozar.
      filter: (req, res) => {
        if (req.path.startsWith('/api/v1/ai/stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Avatar ve şartname metinleri büyük olabilir; sınır bilinçli yükseltildi.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()), environment: env.nodeEnv });
  });

  const api = express.Router();
  api.use(apiLimiter);

  api.use('/auth', authRoutes);
  api.use('/mfa', mfaRoutes);
  api.use('/companies', companiesRoutes);
  api.use('/contacts', contactsRoutes);
  api.use('/deals', dealsRoutes);
  api.use('/offers', offersRoutes);
  api.use('/tenders', tendersRoutes);
  api.use('/contracts', contractsRoutes);
  api.use('/products', productsRoutes);
  api.use('/tickets', ticketsRoutes);
  api.use('/tasks', tasksRoutes);
  api.use('/calendar', calendarRoutes);
  api.use('/email', emailRoutes);
  api.use('/search', searchRoutes);
  api.use('/ai', aiRoutes);
  api.use('/audit-logs', auditRoutes);
  api.use('/exchange-rates', exchangeRatesRoutes);
  api.use('/cities', citiesRoutes);
  api.use('/custom-fields', customFieldsRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/users', usersRoutes);
  api.use('/notes', notesRoutes);
  api.use('/system', systemRoutes);
  api.use('/protocol-visits', protocolRoutes);
  api.use('/documents', documentsRoutes);
  api.use('/activities', activitiesRoutes);
  api.use('/notifications', notificationsRoutes);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
