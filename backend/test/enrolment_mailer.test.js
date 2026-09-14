const assert = require('node:assert/strict');
const test = require('node:test');

const { createEnrolmentMailer } = require('../enrolment_mailer');

test('enrolment mail contains the private link, manual code, downloads, and expiry', async () => {
  const messages = [];
  const mailer = createEnrolmentMailer({
    env: {
      ENROLMENT_EMAIL_ENABLED: 'true',
      SMTP_HOST: 'smtp.test.invalid',
      SMTP_NAME: 'tracker.example.com',
      SMTP_PORT: '587',
      SMTP_FROM: 'Pascoe Neurology <reception@pascoeneurology.com>',
      SMTP_REPLY_TO: 'reception@pascoeneurology.com',
      APP_TIME_ZONE: 'Australia/Brisbane',
    },
    transport: { sendMail: async message => messages.push(message) },
  });

  await mailer.sendEnrolmentPack({
    to: 'patient@example.com',
    displayName: 'Example Patient',
    code: 'ABCD-EFGH-IJKL',
    enrolmentUrl: 'https://tracker.example/enrol#ABCDEFGHIJKL',
    expiresAt: '2026-09-21T00:00:00.000Z',
    googlePlayUrl: 'https://play.example/app',
    appStoreUrl: 'https://apps.example/app',
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'patient@example.com');
  assert.match(messages[0].subject, /NeuroSol Symptom Diary enrolment pack/);
  assert.match(messages[0].text, /ABCD-EFGH-IJKL/);
  assert.match(messages[0].text, /https:\/\/tracker\.example\/enrol#ABCDEFGHIJKL/);
  assert.match(messages[0].text, /https:\/\/play\.example\/app/);
  assert.match(messages[0].text, /https:\/\/apps\.example\/app/);
  assert.match(messages[0].text, /Monday, 21 September 2026 at 10:00 am/);
});

test('enrolment email remains disabled until SMTP is deliberately configured', async () => {
  const mailer = createEnrolmentMailer({ env: {} });
  assert.equal(mailer.enabled, false);
  await assert.rejects(
    mailer.sendEnrolmentPack({}),
    /not configured/,
  );
});

test('SMTP transport announces the configured public hostname', () => {
  let options;
  const mailer = createEnrolmentMailer({
    env: {
      ENROLMENT_EMAIL_ENABLED: 'true',
      SMTP_HOST: 'smtp-relay.gmail.com',
      SMTP_NAME: 'tracker.melindapascoeneurology.com',
      SMTP_FROM: 'reception@pascoeneurology.com',
    },
    transportFactory: value => {
      options = value;
      return { sendMail: async () => {} };
    },
  });

  assert.equal(mailer.enabled, true);
  assert.equal(options.name, 'tracker.melindapascoeneurology.com');
});
