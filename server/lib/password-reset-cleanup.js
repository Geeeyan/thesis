const db = require('../db');

function cleanupPasswordResetData(now = Date.now()) {
  db.transaction(() => {
    db.prepare('DELETE FROM password_reset_codes WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(now);
    db.prepare(`DELETE FROM password_reset_email_limits
      WHERE window_started_at <= ? AND last_requested_at <= ?`).run(now - 60 * 60 * 1000, now - 60 * 60 * 1000);
  })();
}

module.exports = { cleanupPasswordResetData };
