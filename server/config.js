const path = require('path');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const env = process.env;
const isTest = env.NODE_ENV === 'test';
const resolve = (p, fallback) => path.resolve(root, p || fallback);
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const configuredEnv = (name) => {
  const value = (env[name] || '').trim();
  if (/^(?:your(?:[-_ ]|$)|replace[-_ ]with(?:[-_ ]|$))/i.test(value)
    || /@example\.(?:com|net|org)\b/i.test(value)
    || /(?:^|[. ])example\.(?:com|net|org)\b/i.test(value)) return '';
  return value;
};

// Fail fast: a guessable secret means anyone can forge an admin token.
const secret = env.JWT_SECRET || '';
if (!isTest && (secret.length < 32 || secret.startsWith('replace-with'))) {
  console.error(
    'JWT_SECRET is missing, shorter than 32 characters, or still the example value.\n' +
      'Put a private value in .env. To generate one:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
  process.exit(1);
}

module.exports = {
  isTest,
  root,
  apiPort: int(env.API_PORT, 4000),
  webPort: int(env.WEB_PORT, 80),
  arrivalStartHour: int(env.ARRIVAL_START_HOUR, 0),
  arrivalEndHour: int(env.ARRIVAL_END_HOUR, 23),
  sameDayStartCutoffHour: int(env.SAME_DAY_START_CUTOFF_HOUR, 12),
  origins: (env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: secret || 'test-only-secret-test-only-secret-1234',
  tokenTtl: '12h',
  dbPath: resolve(env.DATABASE_PATH, 'server/villa-tjeozabel-app.sqlite'),
  uploadDir: resolve(env.UPLOAD_DIR, 'server/uploads'),
  buildDir: resolve(env.FRONTEND_BUILD_DIR, 'build'),
  timezone: env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
  currency: (env.CURRENCY || 'PHP').toUpperCase(),
  trustProxy: env.TRUST_PROXY || '',
  authRateMax: int(env.AUTH_RATE_MAX, 20),
  publicRateMax: int(env.PUBLIC_RATE_MAX, 60),
  gmailUser: configuredEnv('GMAIL_USER'),
  gmailAppPassword: configuredEnv('GMAIL_APP_PASSWORD').replace(/\s/g, ''),
  passwordResetFrom: configuredEnv('PASSWORD_RESET_FROM'),
  mailTimeoutMs: int(env.MAIL_TIMEOUT_MS, 10000),
  mailRetryCount: int(env.MAIL_RETRY_COUNT, 3),
  mailRetryDelayMs: int(env.MAIL_RETRY_DELAY_MS, 1000),
  bookingReminderHours: int(env.BOOKING_REMINDER_HOURS, 24),
  smtp: {
    host: configuredEnv('MAIL_HOST') || configuredEnv('SMTP_HOST') || (configuredEnv('GMAIL_USER') ? 'smtp.gmail.com' : ''),
    port: int(env.MAIL_PORT || env.SMTP_PORT, 587),
    secure: env.MAIL_ENCRYPTION
      ? ['ssl', 'implicit_tls'].includes(env.MAIL_ENCRYPTION.toLowerCase())
      : env.SMTP_SECURE === undefined
        ? int(env.MAIL_PORT || env.SMTP_PORT, 587) === 465
        : env.SMTP_SECURE.toLowerCase() === 'true',
    user: configuredEnv('MAIL_USERNAME') || configuredEnv('SMTP_USER') || configuredEnv('GMAIL_USER'),
    password: (configuredEnv('MAIL_PASSWORD') || configuredEnv('SMTP_PASSWORD')).replace(/\s/g, '')
      || (configuredEnv('GMAIL_USER') ? configuredEnv('GMAIL_APP_PASSWORD').replace(/\s/g, '') : ''),
    fromName: configuredEnv('MAIL_FROM_NAME') || 'Villa Tjeozabel',
    fromAddress: configuredEnv('MAIL_FROM_ADDRESS'),
    from: configuredEnv('MAIL_FROM_ADDRESS')
        ? `${configuredEnv('MAIL_FROM_NAME') || 'Villa Tjeozabel'} <${configuredEnv('MAIL_FROM_ADDRESS')}>`
        : configuredEnv('SMTP_FROM') || configuredEnv('PASSWORD_RESET_FROM')
          || ((configuredEnv('MAIL_USERNAME') || configuredEnv('SMTP_USER') || configuredEnv('GMAIL_USER'))
        ? `${configuredEnv('MAIL_FROM_NAME') || 'Villa Tjeozabel'} <${configuredEnv('MAIL_USERNAME') || configuredEnv('SMTP_USER') || configuredEnv('GMAIL_USER')}>`
            : ''),
  },
  paymentInstructions: { ewallet: env.PAYMENT_INSTRUCTIONS_EWALLET || '', bank: env.PAYMENT_INSTRUCTIONS_BANK || '' },
  seedAccounts: [
    { role: 'admin', name: env.ADMIN_NAME || 'Administrator', email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    { role: 'staff', name: env.STAFF_NAME || 'Staff', email: env.STAFF_EMAIL, password: env.STAFF_PASSWORD },
  ],
};
