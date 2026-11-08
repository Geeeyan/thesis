const mailer = require('../server/lib/mailer');

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: npm run email:test -- recipient@example.com');
    process.exitCode = 1;
    return;
  }
  if (!mailer.isConfigured()) {
    console.error('Email is not configured. Check the MAIL_* settings in .env.');
    process.exitCode = 1;
    return;
  }
  try {
    await mailer.sendEmail({
      to,
      subject: 'Villa Tjeozabel SMTP test',
      text: 'This is a test message confirming that email delivery is configured.',
      html: '<p>This is a test message confirming that email delivery is configured.</p>',
    });
    console.log('Test email sent successfully.');
  } catch {
    console.error('Test email could not be sent. Check the mail settings and server logs.');
    process.exitCode = 1;
  }
}

main();
