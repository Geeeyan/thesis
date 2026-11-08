const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { ZodError } = require('zod');
const { HttpError } = require('../lib/util');
const config = require('../config');

const make = (limit, message, windowMs = 15 * 60 * 1000) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } });

const authLimiter = make(config.authRateMax, 'Too many attempts. Please wait a few minutes and try again.');
const passwordResetRequestLimiter = make(5, 'Too many password reset requests. Please try again in an hour.', 60 * 60 * 1000);
const passwordResetCodeLimiter = make(10, 'Too many password reset attempts. Please wait 15 minutes and try again.');
const profileSensitiveLimiter = make(15, 'Too many security changes. Please wait 15 minutes and try again.');
const twoFactorLimiter = make(8, 'Too many two-factor attempts. Please wait 15 minutes and try again.');
const publicLimiter = make(config.publicRateMax, 'Too many requests. Please slow down and try again shortly.');

function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError)
    return res.status(400).json({ error: 'Please check the highlighted fields', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  if (err instanceof multer.MulterError)
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (10 MB max)' : 'Upload failed' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}

const notFound = (_req, res) => res.status(404).json({ error: 'Not found' });

module.exports = {
  authLimiter, passwordResetRequestLimiter, passwordResetCodeLimiter, profileSensitiveLimiter,
  twoFactorLimiter, publicLimiter, errorHandler, notFound,
};
