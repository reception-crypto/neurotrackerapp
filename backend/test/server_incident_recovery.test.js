const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'neurosol-incident-recovery-'),
);
process.env.DATA_DIR = testDataDir;
process.env.IDENTITY_SECRET = 'incident-test-secret-at-least-32-characters';
process.env.ADMIN_USER = 'incident-admin';
process.env.ADMIN_PASSWORD = 'incident-admin-password';
process.env.MIN_SUPPORTED_MOBILE_BUILD = '7';
process.env.LATEST_MOBILE_BUILD = '7';
process.env.ENROLMENT_INCIDENT_LOCKDOWN = 'true';

const { app, identityStore } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function adminHeaders(contentType = '') {
  const authorization = `Basic ${Buffer.from(
    'incident-admin:incident-admin-password',
  ).toString('base64')}`;
  return {
    authorization,
    ...(contentType ? { 'content-type': contentType } : {}),
  };
}

function build7Headers(accessToken = '') {
  return {
    'content-type': 'application/json',
    'x-neurosol-build': '7',
    'x-neurosol-profile': 'clinic-managed-v1',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

function enrolmentCodeRecord(code) {
  const compact = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const codeHash = crypto
    .createHmac('sha256', process.env.IDENTITY_SECRET)
    .update(`enrolment-code:${compact}`)
    .digest('hex');
  return identityStore.snapshot().enrolmentCodes[codeHash];
}

const firstProfile = {
  primaryDisorder: 'Migraine',
  primarySymptoms: ['Headache', 'Nausea', 'Fatigue'],
  secondaryDisorder: null,
  secondarySymptoms: [],
};

const secondProfile = {
  primaryDisorder: 'Migraine',
  primarySymptoms: ['Headache', 'Vomiting', 'Vertigo'],
  secondaryDisorder: null,
  secondarySymptoms: [],
};

test('lockdown contains mobile traffic while the portal separates collided codes', async () => {
  const firstSaved = identityStore.saveClinicalProfile({
    displayName: 'Accidental Shared Name One',
    clinicalProfile: firstProfile,
  });
  const firstIssued = identityStore.issueEnrolmentCode({
    patientId: firstSaved.patientId,
    displayName: firstSaved.displayName,
    requireClinicalProfile: true,
  });
  const firstDevice = identityStore.redeemEnrolmentCode(firstIssued.code, {
    supportsClinicManagedProfile: true,
    supportedMobileBuild: 7,
  });
  assert.equal(firstDevice.status, 'ok');

  const secondSaved = identityStore.saveClinicalProfile({
    patientId: firstSaved.patientId,
    displayName: 'Accidental Shared Name Two',
    clinicalProfile: secondProfile,
  });
  const secondIssued = identityStore.issueEnrolmentCode({
    patientId: secondSaved.patientId,
    displayName: secondSaved.displayName,
    requireClinicalProfile: true,
  });

  const health = await fetch(`${baseUrl}/health`).then(response => response.json());
  assert.equal(health.enrolmentIncidentLockdown, true);

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    headers: build7Headers(firstDevice.accessToken),
  });
  assert.equal(profileResponse.status, 503);
  assert.equal((await profileResponse.json()).code, 'clinic_identity_recovery');

  const blockedEnrolment = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: secondIssued.code }),
  });
  assert.equal(blockedEnrolment.status, 503);
  assert.equal(enrolmentCodeRecord(secondIssued.code).usedAt, null);
  assert.equal(enrolmentCodeRecord(secondIssued.code).invalidatedAt, undefined);

  const recoveryPageResponse = await fetch(
    `${baseUrl}/admin/enrolments/recovery`,
    { headers: adminHeaders() },
  );
  assert.equal(recoveryPageResponse.status, 200);
  const recoveryPage = await recoveryPageResponse.text();
  assert.match(recoveryPage, /IDENTITY RECOVERY LOCKDOWN ACTIVE/);
  assert.match(recoveryPage, /Mobile containment is active/);
  const csrfToken = recoveryPage.match(
    /name="csrfToken" value="([a-f0-9]+)"/,
  )?.[1];
  assert.ok(csrfToken);

  const recover = async (originalCode, displayName) => fetch(
    `${baseUrl}/admin/enrolments/recover-collision`,
    {
      method: 'POST',
      headers: adminHeaders('application/x-www-form-urlencoded'),
      body: new URLSearchParams({
        csrfToken,
        originalCode,
        displayName,
        confirmation: 'RECOVER',
      }),
    },
  );

  const firstRecoveryResponse = await recover(
    firstIssued.code,
    'Correct Patient One',
  );
  assert.equal(firstRecoveryResponse.status, 201);
  const firstRecoveryPage = await firstRecoveryResponse.text();
  assert.match(firstRecoveryPage, /Separate identity recovered for Correct Patient One/);
  const replacementCode = firstRecoveryPage.match(
    /<div class="code">([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})<\/div>/,
  )?.[1];
  assert.ok(replacementCode);

  let snapshot = identityStore.snapshot();
  assert.ok(snapshot.patients[firstSaved.patientId].quarantinedAt);
  assert.equal(
    Object.values(snapshot.devices).filter(
      device =>
        (device.recoveryTargetPatientId || device.patientId) ===
          firstSaved.patientId &&
        !device.revokedAt,
    ).length,
    0,
  );
  assert.equal(
    Object.values(snapshot.devices).filter(
      device =>
        device.recoveryTargetPatientId &&
        !device.revokedAt,
    ).length,
    1,
  );
  assert.ok(enrolmentCodeRecord(secondIssued.code).invalidatedAt);

  const blockedReplacement = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({
      code: replacementCode,
      expectedPatientId: firstSaved.patientId,
    }),
  });
  assert.equal(blockedReplacement.status, 503);

  const secondRecoveryResponse = await recover(
    secondIssued.code,
    'Correct Patient Two',
  );
  assert.equal(secondRecoveryResponse.status, 201);
  snapshot = identityStore.snapshot();
  const recoveredPatients = Object.values(snapshot.patients).filter(
    patient => patient.recoveredFrom?.patientId === firstSaved.patientId,
  );
  assert.equal(recoveredPatients.length, 2);
  assert.deepEqual(
    new Set(recoveredPatients.map(patient => patient.displayName)),
    new Set(['Correct Patient One', 'Correct Patient Two']),
  );

  const enrolments = await fetch(`${baseUrl}/admin/enrolments`, {
    headers: adminHeaders(),
  }).then(response => response.text());
  assert.match(enrolments, /QUARANTINED IDENTITY COLLISION/);
  assert.match(enrolments, /Recovered separate identity/);
});
