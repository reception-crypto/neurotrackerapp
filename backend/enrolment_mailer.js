const nodemailer = require('nodemailer');

function booleanSetting(value) {
  return /^(1|true|yes)$/i.test(String(value || '').trim());
}

function createEnrolmentMailer({
  env = process.env,
  transport = null,
  transportFactory = nodemailer.createTransport,
} = {}) {
  const enabled = booleanSetting(env.ENROLMENT_EMAIL_ENABLED);
  const host = String(env.SMTP_HOST || '').trim();
  const name = String(env.SMTP_NAME || '').trim();
  const port = Number(env.SMTP_PORT || 587);
  const from = String(env.SMTP_FROM || '').trim();
  const replyTo = String(env.SMTP_REPLY_TO || from).trim();
  const user = String(env.SMTP_USER || '').trim();
  const password = String(env.SMTP_PASSWORD || '');

  if (enabled && (!host || !from || !Number.isInteger(port))) {
    throw new Error(
      'Automatic enrolment email requires SMTP_HOST, SMTP_PORT, and SMTP_FROM.',
    );
  }
  if (enabled && Boolean(user) !== Boolean(password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be supplied together.');
  }

  const smtpTransport = transport || (enabled ? transportFactory({
    host,
    ...(name ? { name } : {}),
    port,
    secure: booleanSetting(env.SMTP_SECURE),
    requireTLS: !booleanSetting(env.SMTP_SECURE),
    ...(user ? { auth: { user, pass: password } } : {}),
  }) : null);

  async function sendEnrolmentPack({ to, displayName, code, enrolmentUrl,
    expiresAt, googlePlayUrl, appStoreUrl }) {
    if (!enabled) {
      throw new Error('Automatic enrolment email is not configured.');
    }
    const expiry = new Date(expiresAt).toLocaleString('en-AU', {
      timeZone: env.APP_TIME_ZONE || 'Australia/Brisbane',
      dateStyle: 'full',
      timeStyle: 'short',
    });
    const downloads = [
      googlePlayUrl ? `Android: ${googlePlayUrl}` : '',
      appStoreUrl ? `iPhone: ${appStoreUrl}` : '',
    ].filter(Boolean).join('\n');
    const text = `Hello ${displayName},\n\nYour NeuroSol Symptom Diary profile is ready.\n\n1. Download the app:\n${downloads}\n\n2. Open this private enrolment link:\n${enrolmentUrl}\n\nIf needed, enter this one-time code manually: ${code}\n\nThe code expires ${expiry} and can be used once. Please do not forward it.\n\nThe app is not monitored for emergencies. For urgent medical help, call 000.\n\nPascoe Neurology`;
    const html = `<p>Hello ${escapeHtml(displayName)},</p><p>Your <strong>NeuroSol Symptom Diary</strong> profile is ready.</p><ol><li>Download the app: ${[
      googlePlayUrl ? `<a href="${escapeHtml(googlePlayUrl)}">Android</a>` : '',
      appStoreUrl ? `<a href="${escapeHtml(appStoreUrl)}">iPhone</a>` : '',
    ].filter(Boolean).join(' · ')}</li><li><a href="${escapeHtml(enrolmentUrl)}"><strong>Open your private enrolment link</strong></a></li></ol><p>If needed, enter this one-time code manually: <strong>${escapeHtml(code)}</strong></p><p>The code expires ${escapeHtml(expiry)} and can be used once. Please do not forward it.</p><p>The app is not monitored for emergencies. For urgent medical help, call 000.</p><p>Pascoe Neurology</p>`;
    return smtpTransport.sendMail({
      from,
      replyTo: replyTo || undefined,
      to,
      subject: 'Your NeuroSol Symptom Diary enrolment pack',
      text,
      html,
    });
  }

  return { enabled, sendEnrolmentPack };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

module.exports = { createEnrolmentMailer };
