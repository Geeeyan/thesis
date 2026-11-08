const nodemailer = require('nodemailer');
const config = require('../config');

const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const hasSmtpCredentials = () => Boolean(config.smtp.user && config.smtp.password);
const hasPartialSmtpCredentials = () => Boolean(config.smtp.user) !== Boolean(config.smtp.password);
const requiresSmtpCredentials = () => config.smtp.host.toLowerCase() === 'smtp.gmail.com';
const isConfigured = () => Boolean(config.smtp.host && config.smtp.from)
  && !hasPartialSmtpCredentials()
  && (!requiresSmtpCredentials() || hasSmtpCredentials());

let transporter;

function getTransporter() {
  if (!isConfigured()) {
    throw new Error('SMTP email delivery is not configured');
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure && config.smtp.port === 587,
      connectionTimeout: config.mailTimeoutMs,
      greetingTimeout: config.mailTimeoutMs,
      socketTimeout: config.mailTimeoutMs,
      ...(hasSmtpCredentials() && { auth: { user: config.smtp.user, pass: config.smtp.password } }),
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function brandedMessage(html, text) {
  const safeBody = html || `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  const safeText = text || safeBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    html: `<!doctype html><html><body style="margin:0;background:#fff1e6;color:#1a1a1a;font-family:Arial,sans-serif">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:#fff1e6"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
      <tr><td style="padding:20px 28px;background:#ff8c42;color:#1a1a1a;font-size:20px;font-weight:bold">Villa Tjeozabel</td></tr>
      <tr><td style="padding:28px;line-height:1.6">${safeBody}</td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eeeeee;color:#555555;font-size:12px">Villa Tjeozabel · Thank you for choosing us.</td></tr>
      </table></td></tr></table></body></html>`,
    text: `${safeText}\n\nVilla Tjeozabel`,
  };
}

function buildTemplate(template, data = {}) {
  const rawFields = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    String(value ?? '').replace(/[\r\n]/g, ' ').trim(),
  ]));
  const fields = Object.fromEntries(Object.entries(rawFields).map(([key, value]) => [key, escapeHtml(value)]));
  const bookingDetails = `<p><strong>Service:</strong> ${fields.service || '—'}<br>
    <strong>Date:</strong> ${fields.date || '—'}<br>
    <strong>Check-in:</strong> ${fields.startTime || '—'}<br>
    <strong>Check-out:</strong> ${fields.endTime || '—'}<br>
    <strong>Duration:</strong> ${fields.duration || '—'}<br>
    <strong>Total:</strong> ${fields.total || '—'}<br>
    <strong>Booking reference:</strong> ${fields.reference || '—'}</p>`;
  const templates = {
    password_reset: {
      subject: 'Your password reset code',
      text: `Your Villa Tjeozabel password reset code is ${data.code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
      html: `<p>Your Villa Tjeozabel password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${escapeHtml(data.code)}</p><p>This code expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
    },
    password_changed: {
      subject: 'Your password was changed',
      text: 'Your Villa Tjeozabel account password was changed. If you did not make this change, contact support immediately.',
      html: '<p>Your Villa Tjeozabel account password was changed.</p><p>If you did not make this change, contact support immediately.</p>',
    },
    booking_received: {
      subject: `We received your booking request${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `We received your booking request. It is awaiting confirmation.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>We received your booking request. Our team will confirm it shortly.</p>${bookingDetails}`,
    },
    booking_confirmation: {
      subject: `Booking confirmation${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `Your booking is confirmed.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>Your booking is confirmed.</p>${bookingDetails}`,
    },
    booking_reminder: {
      subject: `Reminder: your upcoming booking${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `This is a reminder about your upcoming booking.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>This is a reminder about your upcoming booking.</p>${bookingDetails}`,
    },
    booking_cancellation: {
      subject: `Booking cancelled${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `Your booking has been cancelled.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>Your booking has been cancelled.</p>${bookingDetails}`,
    },
    booking_reschedule: {
      subject: `Booking rescheduled${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `Your booking has been rescheduled.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>Your booking has been rescheduled.</p>${bookingDetails}`,
    },
    reschedule_request: {
      subject: `Reschedule request received${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `We received your request to reschedule. Our team will review it.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>We received your request to reschedule. Our team will review it.</p>${bookingDetails}`,
    },
    cancellation_request: {
      subject: `Cancellation request received${rawFields.reference ? ` (${rawFields.reference})` : ''}`,
      text: `We received your cancellation request. Our team will review it.\nService: ${rawFields.service || '—'}\nDate: ${rawFields.date || '—'}\nCheck-in: ${rawFields.startTime || '—'}\nCheck-out: ${rawFields.endTime || '—'}\nDuration: ${rawFields.duration || '—'}\nTotal: ${rawFields.total || '—'}\nBooking reference: ${rawFields.reference || '—'}`,
      html: `<p>We received your cancellation request. Our team will review it.</p>${bookingDetails}`,
    },
  };
  if (!templates[template]) throw new Error('Unknown email template');
  return templates[template];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendEmail({ to, subject, text, html }) {
  const recipient = typeof to === 'string' ? to.trim() : '';
  if (!EMAIL_PATTERN.test(recipient)) throw new Error('A valid email recipient is required');
  if (!subject || /[\r\n]/.test(subject) || (!text && !html)) {
    throw new Error('Email subject and message content are required');
  }
  const message = brandedMessage(html, text);
  const mailTransport = getTransporter();
  let lastCode = 'unknown';
  for (let attempt = 0; attempt < config.mailRetryCount; attempt += 1) {
    try {
      return await mailTransport.sendMail({
        from: config.smtp.from,
        to: recipient,
        subject,
        ...message,
      });
    } catch (error) {
      lastCode = /^[A-Z0-9_]{1,40}$/i.test(error.code || '') ? error.code : error.name || 'unknown';
      if (attempt + 1 < config.mailRetryCount) {
        await sleep(config.mailRetryDelayMs * (attempt + 1));
      }
    }
  }
  console.error('Email delivery failed after retries:', lastCode);
  throw new Error('Email delivery failed');
}

function sendTemplate(to, template, data) {
  return sendEmail({ to, ...buildTemplate(template, data) });
}

function sendEmailInBackground(to, template, data) {
  if (config.isTest) return;
  setImmediate(() => {
    sendTemplate(to, template, data).catch((error) => {
      console.error('Background email delivery failed:', error.message === 'SMTP email delivery is not configured'
        ? 'not_configured'
        : error.message === 'Email delivery failed' ? 'delivery_error' : 'template_error');
    });
  });
}

async function sendPasswordResetCode(email, code) {
  return sendTemplate(email, 'password_reset', { code });
}

async function sendPasswordChangedConfirmation(email) {
  return sendTemplate(email, 'password_changed');
}

module.exports = {
  isConfigured,
  sendEmail,
  sendTemplate,
  sendEmailInBackground,
  sendPasswordResetCode,
  sendPasswordChangedConfirmation,
  buildTemplate,
};
