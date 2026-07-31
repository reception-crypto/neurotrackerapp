const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-'));
process.env.DATA_DIR = testDataDir;
process.env.IDENTITY_SECRET = 'test-only-identity-secret-at-least-32-characters';
process.env.ADMIN_USER = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.REVIEW_ENROLMENT_CODE = 'R3VW4CC3SS99';
process.env.REVIEW_PATIENT_ID_PREFIX = 'pt-review-google-play';
process.env.REVIEW_DISPLAY_NAME = 'Google Play Review';
// The main suite also exercises the temporary Build 6 compatibility window.
// Production defaults to the latest build and has a separate enforcement test.
process.env.MIN_SUPPORTED_MOBILE_BUILD = '6';
process.env.LATEST_MOBILE_BUILD = '7';

const {
  app,
  identityStore,
  patientDirectory,
} = require('../server');

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

function validSubmission({
  submissionId = 'NS-test-001',
  patientId = 'pt-test-001',
  patientName = 'Synthetic Patient',
  date = '2026-07-17',
} = {}) {
  return {
    submissionId,
    patientId,
    patientName,
    date,
    time: '19:00',
    wellnessPercent: 70,
    records: [
      { track: 'Primary', disorder: 'Migraine', symptom: 'Headache', score: 4 },
      { track: 'Primary', disorder: 'Migraine', symptom: 'Nausea', score: 2 },
      { track: 'Primary', disorder: 'Migraine', symptom: 'Fatigue', score: 5 },
    ],
  };
}

const assignedClinicalProfile = {
  primaryDisorder: 'Migraine',
  primarySymptoms: ['Headache', 'Nausea', 'Fatigue'],
  secondaryDisorder: null,
  secondarySymptoms: [],
};

function build7Headers(accessToken = '', json = true) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-neurosol-build': '7',
    'x-neurosol-profile': 'clinic-managed-v1',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function enrol({
  patientId = '',
  displayName = 'Synthetic Patient',
} = {}) {
  const issued = identityStore.issueEnrolmentCode({ patientId, displayName });
  const response = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(response.status, 200);
  return {
    issued,
    ...(await response.json()),
  };
}

async function enrolClinicManaged({
  patientId,
  displayName = 'Clinic Managed Patient',
  clinicalProfile = assignedClinicalProfile,
}) {
  const saved = identityStore.saveClinicalProfile({
    patientId,
    displayName,
    clinicalProfile,
  });
  const issued = identityStore.issueEnrolmentCode({
    patientId: saved.patientId,
    displayName: saved.displayName,
    requireClinicalProfile: true,
  });
  const response = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(response.status, 200);
  return {
    issued,
    saved,
    ...(await response.json()),
  };
}

async function post(body, accessToken = '', { clinicManaged = false } = {}) {
  return fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: clinicManaged
      ? build7Headers(accessToken)
      : {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
    body: JSON.stringify(body),
  });
}

function adminHeaders() {
  const credentials = Buffer.from('test-admin:test-admin-password').toString(
    'base64',
  );
  return { authorization: `Basic ${credentials}` };
}

test('production refuses placeholder deployment secrets', () => {
  const configDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'neurosol-config-'),
  );
  const result = childProcess.spawnSync(
    process.execPath,
    ['-e', 'require("./server")'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATA_DIR: configDataDir,
        IDENTITY_SECRET: 'replace-with-at-least-32-random-characters',
        ADMIN_PASSWORD: 'replace-with-a-long-unique-admin-password',
      },
    },
  );
  fs.rmSync(configDataDir, { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /IDENTITY_SECRET and ADMIN_PASSWORD must be configured/,
  );
});

test('production defaults to requiring the latest mobile build', () => {
  const configDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'neurosol-version-'),
  );
  const result = childProcess.spawnSync(
    process.execPath,
    [
      '-e',
      `
        const { app } = require('./server');
        const server = app.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;
          const response = await fetch('http://127.0.0.1:' + port + '/api/enrol', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: 'AAAAAAAAAAAA' }),
          });
          console.log(response.status);
          server.close();
        });
      `,
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATA_DIR: configDataDir,
        MIN_SUPPORTED_MOBILE_BUILD: '',
        LATEST_MOBILE_BUILD: '7',
      },
    },
  );
  fs.rmSync(configDataDir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /426/);
});

test('rejects uploads from a device that is not enrolled', async () => {
  const response = await post(validSubmission());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'device_not_authorised');
});

test('enrolment codes are one-time and return a stable PatientId', async () => {
  const issued = identityStore.issueEnrolmentCode({
    patientId: 'pt-enrolment-test',
    displayName: 'Enrolment Test',
  });

  const first = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code.toLowerCase() }),
  });
  assert.equal(first.status, 200);
  const identity = await first.json();
  assert.equal(identity.patientId, 'pt-enrolment-test');
  assert.ok(identity.accessToken.length >= 32);

  const second = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(second.status, 410);
});

test('clinic-managed codes require Build 7 and are not consumed by Build 6', async () => {
  const saved = identityStore.saveClinicalProfile({
    patientId: 'pt-clinic-managed-enrolment',
    displayName: 'Clinic Managed Enrolment',
    clinicalProfile: assignedClinicalProfile,
  });
  const issued = identityStore.issueEnrolmentCode({
    patientId: saved.patientId,
    displayName: saved.displayName,
    requireClinicalProfile: true,
  });

  const oldClient = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(oldClient.status, 426);
  assert.equal((await oldClient.json()).code, 'app_update_required');

  const currentClient = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(currentClient.status, 200);
  const identity = await currentClient.json();
  assert.equal(identity.patientId, saved.patientId);
  assert.equal(identity.clinicalProfile.revision, 1);
  assert.deepEqual(
    identity.clinicalProfile.primarySymptoms,
    assignedClinicalProfile.primarySymptoms,
  );
});

test('public enrolment links disclose no patient details and do not consume codes', async () => {
  const saved = identityStore.saveClinicalProfile({
    patientId: 'pt-enrolment-link',
    displayName: 'Private Link Patient',
    clinicalProfile: assignedClinicalProfile,
  });
  const issued = identityStore.issueEnrolmentCode({
    patientId: saved.patientId,
    displayName: saved.displayName,
    requireClinicalProfile: true,
  });
  const linkResponse = await fetch(
    `${baseUrl}/enrol#${issued.code}`,
  );
  assert.equal(linkResponse.status, 200);
  assert.equal(linkResponse.headers.get('cache-control'), 'no-store');
  const page = await linkResponse.text();
  assert.match(page, /NeuroSol Symptom Diary/);
  assert.match(page, /location\.hash/);
  assert.doesNotMatch(page, new RegExp(issued.code));
  assert.doesNotMatch(page, /Private Link Patient/);

  const enrolResponse = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(enrolResponse.status, 200);
});

test('Google Play reviewer access is reusable and synthetic-only', async () => {
  const enrolReviewer = () => fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'R3VW-4CC3-SS99' }),
  });

  const first = await enrolReviewer();
  assert.equal(first.status, 200);
  const firstIdentity = await first.json();
  assert.match(
    firstIdentity.patientId,
    /^pt-review-google-play-[0-9a-f-]{36}$/,
  );
  assert.equal(firstIdentity.displayName, 'Google Play Review');

  const second = await enrolReviewer();
  assert.equal(second.status, 200);
  const secondIdentity = await second.json();
  assert.match(
    secondIdentity.patientId,
    /^pt-review-google-play-[0-9a-f-]{36}$/,
  );
  assert.notEqual(secondIdentity.patientId, firstIdentity.patientId);
  assert.notEqual(secondIdentity.accessToken, firstIdentity.accessToken);

  const reconnect = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'R3VW-4CC3-SS99',
      expectedPatientId: firstIdentity.patientId,
    }),
  });
  assert.equal(reconnect.status, 200);
  assert.equal((await reconnect.json()).patientId, firstIdentity.patientId);

  const storedIdentity = fs.readFileSync(
    path.join(testDataDir, 'identity_store.json'),
    'utf8',
  );
  assert.equal(storedIdentity.includes('R3VW4CC3SS99'), false);
  assert.equal(
    identityStore.snapshot().patients[firstIdentity.patientId].reviewIdentity,
    true,
  );
  identityStore.updatePatientDisplayName(
    firstIdentity.patientId,
    'Google Play Review',
  );
  assert.equal(
    identityStore.snapshot().patients[firstIdentity.patientId].reviewIdentity,
    true,
  );
});

test('reviewer access cannot replace another clinic identity', async () => {
  const response = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'R3VW-4CC3-SS99',
      expectedPatientId: 'pt-real-patient',
    }),
  });
  assert.equal(response.status, 409);
  assert.equal(
    (await response.json()).code,
    'enrolment_patient_mismatch',
  );
});

test('a recovery code is not consumed for the wrong existing PatientId', async () => {
  const issued = identityStore.issueEnrolmentCode({
    patientId: 'pt-expected-recovery',
    displayName: 'Expected Recovery',
  });

  const mismatch = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: issued.code,
      expectedPatientId: 'pt-different-patient',
    }),
  });
  assert.equal(mismatch.status, 409);
  assert.equal(
    (await mismatch.json()).code,
    'enrolment_patient_mismatch',
  );

  const correct = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: issued.code,
      expectedPatientId: issued.patientId,
    }),
  });
  assert.equal(correct.status, 200);
  assert.equal((await correct.json()).patientId, issued.patientId);
});

test('admin profile forms require CSRF and never store plaintext codes', async () => {
  const pageResponse = await fetch(`${baseUrl}/admin/enrolments`, {
    headers: adminHeaders(),
  });
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  const csrfToken = page.match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
  assert.ok(csrfToken);

  const withoutCsrf = await fetch(
    `${baseUrl}/admin/enrolments/save-profile`,
    {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
      body: new URLSearchParams({ displayName: 'CSRF Test' }),
    },
  );
  assert.equal(withoutCsrf.status, 403);

  const form = new URLSearchParams({
    csrfToken,
    displayName: 'Portal Enrolment Test',
    primaryDisorder: 'Migraine',
    secondaryDisorder: '',
    action: 'save-and-issue',
  });
  for (const symptom of ['Headache', 'Nausea', 'Vomiting']) {
    form.append('primarySymptoms', symptom);
  }
  const issued = await fetch(`${baseUrl}/admin/enrolments/save-profile`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  assert.equal(issued.status, 201);
  const issuedPage = await issued.text();
  const code = issuedPage.match(/\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/)?.[1];
  assert.ok(code);

  const storedIdentity = fs.readFileSync(
    path.join(testDataDir, 'identity_store.json'),
    'utf8',
  );
  assert.equal(storedIdentity.includes(code), false);
  assert.equal(storedIdentity.includes(code.replaceAll('-', '')), false);
});

test('clinic profile synchronises and controls Build 7 submissions', async () => {
  const identity = await enrolClinicManaged({
    patientId: 'pt-profile-sync',
    displayName: 'Clinic Profile Name',
  });

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    headers: build7Headers(identity.accessToken, false),
  });
  assert.equal(profileResponse.status, 200);
  const profileBody = await profileResponse.json();
  assert.equal(profileBody.displayName, 'Clinic Profile Name');
  assert.equal(profileBody.clinicalProfile.revision, 1);

  const acceptedBody = validSubmission({
    submissionId: 'NS-clinic-profile-accepted',
    patientId: identity.patientId,
    patientName: 'Untrusted App Name',
    date: '2026-07-28',
  });
  acceptedBody.profileRevision = 1;
  const accepted = await post(
    acceptedBody,
    identity.accessToken,
    { clinicManaged: true },
  );
  assert.equal(accepted.status, 201);

  const wrongBody = validSubmission({
    submissionId: 'NS-clinic-profile-wrong',
    patientId: identity.patientId,
    date: '2026-07-29',
  });
  wrongBody.profileRevision = 1;
  wrongBody.records[2].symptom = 'Vomiting';
  const wrong = await post(
    wrongBody,
    identity.accessToken,
    { clinicManaged: true },
  );
  assert.equal(wrong.status, 409);
  assert.equal((await wrong.json()).code, 'assigned_profile_mismatch');

  const csv = fs.readFileSync(
    path.join(testDataDir, 'symptom_entries.csv'),
    'utf8',
  );
  assert.match(csv, /Clinic Profile Name/);
  assert.doesNotMatch(csv, /Untrusted App Name/);
});

test('queued Build 6 entries and historical profile revisions remain valid', async () => {
  const identity = await enrolClinicManaged({
    patientId: 'pt-profile-history',
    displayName: 'Profile History',
  });
  const updated = identityStore.saveClinicalProfile({
    patientId: identity.patientId,
    displayName: 'Profile History',
    clinicalProfile: {
      ...assignedClinicalProfile,
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
    },
  });
  assert.equal(updated.clinicalProfile.revision, 2);

  const oldRevision = validSubmission({
    submissionId: 'NS-profile-history-old',
    patientId: identity.patientId,
    date: '2026-07-29',
  });
  oldRevision.profileRevision = 1;
  const acceptedOld = await post(
    oldRevision,
    identity.accessToken,
    { clinicManaged: true },
  );
  assert.equal(acceptedOld.status, 201);

  const queuedBuild6 = validSubmission({
    submissionId: 'NS-profile-history-queued',
    patientId: identity.patientId,
    date: '2026-07-30',
  });
  queuedBuild6.records[2].symptom = 'Vomiting';
  const acceptedQueued = await post(
    queuedBuild6,
    identity.accessToken,
    { clinicManaged: true },
  );
  assert.equal(acceptedQueued.status, 201);

  const rows = fs.readFileSync(
    path.join(testDataDir, 'symptom_entries.csv'),
    'utf8',
  ).split('\n');
  assert.equal(
    rows.filter(row => row.includes('NS-profile-history-old'))
      .every(row => row.endsWith(',1')),
    true,
  );
  assert.equal(
    rows.filter(row => row.includes('NS-profile-history-queued'))
      .every(row => row.endsWith(',2')),
    true,
  );
});

test('configured Build 6 devices are limited to the clinic-assigned symptoms', async () => {
  const identity = await enrolClinicManaged({
    patientId: 'pt-build6-transition-profile',
    displayName: 'Build 6 Transition',
  });
  const matching = validSubmission({
    submissionId: 'NS-build6-transition-matching',
    patientId: identity.patientId,
    date: '2026-08-01',
  });
  const accepted = await post(matching, identity.accessToken);
  assert.equal(accepted.status, 201);

  const changed = validSubmission({
    submissionId: 'NS-build6-transition-changed',
    patientId: identity.patientId,
    date: '2026-08-02',
  });
  changed.records[2].symptom = 'Vomiting';
  const rejected = await post(changed, identity.accessToken);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, 'assigned_profile_mismatch');
});

test('an enrolled device cannot submit another PatientId', async () => {
  const identity = await enrol({
    patientId: 'pt-identity-owner',
    displayName: 'Identity Owner',
  });
  const response = await post(
    validSubmission({
      submissionId: 'NS-identity-mismatch',
      patientId: 'pt-someone-else',
      date: '2026-07-18',
    }),
    identity.accessToken,
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'patient_identity_mismatch');
});

test('rejects missing symptom scores', async () => {
  const identity = await enrol({
    patientId: 'pt-validation-test',
    displayName: 'Validation Test',
  });
  const body = validSubmission({
    submissionId: 'NS-validation-test',
    patientId: identity.patientId,
    date: '2026-07-19',
  });
  body.records.pop();
  const response = await post(body, identity.accessToken);
  assert.equal(response.status, 400);
});

test('rejects duplicate symptoms and non-step wellness values', async () => {
  const identity = await enrol({
    patientId: 'pt-field-integrity',
    displayName: 'Field Integrity',
  });
  const duplicateSymptoms = validSubmission({
    submissionId: 'NS-duplicate-symptoms',
    patientId: identity.patientId,
    date: '2026-07-19',
  });
  duplicateSymptoms.records[1].symptom = duplicateSymptoms.records[0].symptom;
  const duplicateResponse = await post(
    duplicateSymptoms,
    identity.accessToken,
  );
  assert.equal(duplicateResponse.status, 400);

  const invalidWellness = validSubmission({
    submissionId: 'NS-invalid-wellness',
    patientId: identity.patientId,
    date: '2026-07-19',
  });
  invalidWellness.wellnessPercent = 73;
  const wellnessResponse = await post(
    invalidWellness,
    identity.accessToken,
  );
  assert.equal(wellnessResponse.status, 400);

  const blankScore = validSubmission({
    submissionId: 'NS-blank-score',
    patientId: identity.patientId,
    date: '2026-07-19',
  });
  blankScore.records[0].score = '';
  const blankScoreResponse = await post(blankScore, identity.accessToken);
  assert.equal(blankScoreResponse.status, 400);
});

test('stores an exact submission retry only once', async () => {
  const identity = await enrol({
    patientId: 'pt-idempotency-test',
    displayName: 'Idempotency Test',
  });
  const body = validSubmission({
    patientId: identity.patientId,
    submissionId: 'NS-idempotency-test',
    date: '2026-07-20',
  });

  const first = await post(body, identity.accessToken);
  assert.equal(first.status, 201);
  assert.equal((await first.json()).duplicate, false);

  const retry = await post(body, identity.accessToken);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);

  const csv = fs.readFileSync(
    path.join(testDataDir, 'symptom_entries.csv'),
    'utf8',
  );
  assert.equal(
    csv.split('\n').filter(line => line.includes('NS-idempotency-test')).length,
    3,
  );
});

test('accepts only one daily submission for each PatientId', async () => {
  const firstPatient = await enrol({
    patientId: 'pt-daily-first',
    displayName: 'Daily First',
  });
  const secondPatient = await enrol({
    patientId: 'pt-daily-second',
    displayName: 'Daily Second',
  });
  const date = '2026-07-21';

  const accepted = await post(
    validSubmission({
      submissionId: 'NS-daily-first-a',
      patientId: firstPatient.patientId,
      date,
    }),
    firstPatient.accessToken,
  );
  assert.equal(accepted.status, 201);

  const rejected = await post(
    validSubmission({
      submissionId: 'NS-daily-first-b',
      patientId: firstPatient.patientId,
      date,
    }),
    firstPatient.accessToken,
  );
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, 'daily_submission_exists');

  const otherPatient = await post(
    validSubmission({
      submissionId: 'NS-daily-second',
      patientId: secondPatient.patientId,
      date,
    }),
    secondPatient.accessToken,
  );
  assert.equal(otherPatient.status, 201);
});

test('does not treat another patient submission ID as an exact retry', async () => {
  const firstPatient = await enrol({
    patientId: 'pt-submission-id-first',
    displayName: 'Submission First',
  });
  const secondPatient = await enrol({
    patientId: 'pt-submission-id-second',
    displayName: 'Submission Second',
  });
  const submissionId = 'NS-shared-submission-id';

  const accepted = await post(
    validSubmission({
      submissionId,
      patientId: firstPatient.patientId,
      date: '2026-07-25',
    }),
    firstPatient.accessToken,
  );
  assert.equal(accepted.status, 201);

  const conflict = await post(
    validSubmission({
      submissionId,
      patientId: secondPatient.patientId,
      date: '2026-07-26',
    }),
    secondPatient.accessToken,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'submission_id_conflict');
});

test('portal groups by PatientId and displays only the latest name', async () => {
  const identity = await enrol({
    patientId: 'pt-name-change',
    displayName: 'Earlier Name',
  });
  const earlier = await post(
    validSubmission({
      submissionId: 'NS-name-earlier',
      patientId: identity.patientId,
      patientName: 'Earlier Name',
      date: '2026-07-22',
    }),
    identity.accessToken,
  );
  assert.equal(earlier.status, 201);
  const latest = await post(
    validSubmission({
      submissionId: 'NS-name-latest',
      patientId: identity.patientId,
      patientName: 'Latest Name',
      date: '2026-07-23',
    }),
    identity.accessToken,
  );
  assert.equal(latest.status, 201);

  const response = await fetch(
    `${baseUrl}/admin?patientId=${encodeURIComponent(identity.patientId)}`,
    { headers: adminHeaders() },
  );
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Latest Name \(NS-/);
  assert.doesNotMatch(page, />Earlier Name \(NS-/);
  assert.equal(
    page.split(`value="${identity.patientId}"`).length - 1,
    1,
  );

  const directory = patientDirectory([
    {
      PatientId: identity.patientId,
      Patient: 'Earlier Name',
      ReceivedAt: '2026-07-22T10:00:00.000Z',
    },
    {
      PatientId: identity.patientId,
      Patient: 'Latest Name',
      ReceivedAt: '2026-07-23T10:00:00.000Z',
    },
  ]);
  assert.equal(directory.size, 1);
  assert.equal(directory.get(identity.patientId).displayName, 'Latest Name');
});

test('a recovery code keeps the PatientId and revoked devices are rejected', async () => {
  const original = await enrol({
    patientId: 'pt-recovery-test',
    displayName: 'Recovery Test',
  });
  const recovery = await enrol({
    patientId: original.patientId,
    displayName: 'Recovery Test',
  });
  assert.equal(recovery.patientId, original.patientId);

  const revoked = identityStore.revokePatientDevices(original.patientId);
  assert.equal(revoked, 2);

  const response = await post(
    validSubmission({
      submissionId: 'NS-revoked-device',
      patientId: original.patientId,
      date: '2026-07-24',
    }),
    recovery.accessToken,
  );
  assert.equal(response.status, 401);
});

test('patient deletion requires typed Support ID and creates backups', async () => {
  const identity = await enrolClinicManaged({
    patientId: 'pt-delete-synthetic',
    displayName: 'Delete Synthetic',
  });
  const body = validSubmission({
    submissionId: 'NS-delete-synthetic',
    patientId: identity.patientId,
    date: '2026-07-31',
  });
  body.profileRevision = 1;
  const submission = await post(
    body,
    identity.accessToken,
    { clinicManaged: true },
  );
  assert.equal(submission.status, 201);

  const pageResponse = await fetch(`${baseUrl}/admin/patients`, {
    headers: adminHeaders(),
  });
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  const csrfToken = page.match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
  assert.ok(csrfToken);

  const wrongConfirmation = await fetch(
    `${baseUrl}/admin/patients/delete`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        csrfToken,
        patientId: identity.patientId,
        confirmation: 'NS-WRONG',
      }),
    },
  );
  assert.equal(wrongConfirmation.status, 400);
  assert.ok(identityStore.snapshot().patients[identity.patientId]);

  const confirmed = await fetch(`${baseUrl}/admin/patients/delete`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      patientId: identity.patientId,
      confirmation: identity.saved.supportId,
    }),
  });
  assert.equal(confirmed.status, 200);
  assert.equal(
    identityStore.snapshot().patients[identity.patientId],
    undefined,
  );
  const csv = fs.readFileSync(
    path.join(testDataDir, 'symptom_entries.csv'),
    'utf8',
  );
  assert.equal(csv.includes(identity.patientId), false);
  const backups = fs.readdirSync(path.join(testDataDir, 'backups'));
  assert.ok(backups.some(name => name.endsWith('-symptom_entries.csv')));
  assert.ok(backups.some(name => name.endsWith('-identity_store.json')));
});
