const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { seedServices, seedAccounts } = require('./seed');
const { errorHandler, notFound } = require('./middleware/errors');
const { expireUnpaidWalkIns } = require('./lib/walkin-expiration');
const { cleanupPasswordResetData } = require('./lib/password-reset-cleanup');
const { sendDueBookingReminders, REMINDER_INTERVAL_MS } = require('./lib/booking-reminders');

function createApp() {
  seedServices();
  seedAccounts();
  expireUnpaidWalkIns();
  cleanupPasswordResetData();
  const expirationTimer = setInterval(expireUnpaidWalkIns, 60 * 1000);
  expirationTimer.unref();
  const passwordResetCleanupTimer = setInterval(cleanupPasswordResetData, 60 * 1000);
  passwordResetCleanupTimer.unref();
  sendDueBookingReminders().catch(() => console.error('Booking reminder scheduler failed'));
  const bookingReminderTimer = setInterval(() => {
    sendDueBookingReminders().catch(() => console.error('Booking reminder scheduler failed'));
  }, REMINDER_INTERVAL_MS);
  bookingReminderTimer.unref();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy);

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store'); // never cache personal data
    next();
  });
  app.use(cors({ origin: config.origins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/profile', require('./routes/profile'));
  app.use('/api/messages', require('./routes/messages'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/services', require('./routes/services'));
  app.use('/api/services', require('./routes/listing-photos'));
  app.use('/api/availability', require('./routes/availability'));
  app.use('/api/reservations', require('./routes/reservations'));
  app.use('/api', require('./routes/payments'));
  app.use('/api/documents', require('./routes/documents'));
  app.use('/api/site-assets', require('./routes/site-assets'));
  app.use('/api/staff', require('./routes/staff'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api', notFound);

  // Serve the built React app (only static files from build/, never the uploads folder).
  const index = path.join(config.buildDir, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(config.buildDir));
    app.get('/{*splat}', (_req, res) => res.sendFile(index));
  } else {
    app.get('/', (_req, res) => res.json({ name: 'Villa Tjeozabel API', note: 'No frontend build found. Run the React build to serve the site here.' }));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
