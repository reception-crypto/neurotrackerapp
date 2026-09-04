'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-build9-'));
process.env.DATA_DIR = testDataDir;
process.env.IDENTITY_SECRET =
  'build9-test-identity-secret-at-least-32-characters';
process.env.ADMIN_USER = 'build9-admin';
process.env.ADMIN_PASSWORD = 'build9-admin-password';
process.env.MIN_SUPPORTED_MOBILE_BUILD = '7';
process.env.LATEST_MOBILE_BUILD = '9';
process.env.MAX_BACKDATE_DAYS = '7';
process.env.ENABLE_CUSTOM_DISORDERS = 'true';
process.env.ENABLE_INDEPENDENT_PROFILES = 'true';
process.env.REVIEW_ENROLMENT_CODE = '';
process.env.REVIEW_PATIENT_ID_PREFIX = '';
process.env.REVIEW_DISPLAY_NAME = '';

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

function adminHeaders() {
  const credentials = Buffer.from(
    'build9-admin:build9-admin-password',
  ).toString('base64');
  return { authorization: `Basic ${credentials}` };
}

function mobileHeaders(build, accessToken = '', { json = false } = {}) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-neurosol-build': String(build),
    'x-neurosol-profile': 'clinic-managed-v1',
    ...(build >= 8
      ? {
          'x-neurosol-disorders': 'canonical-v1',
          'x-neurosol-profile-model': 'independent-v1',
        }
      : {}),
    ...(build >= 9 ? { 'x-neurosol-diary': 'patient-diary-v1' } : {}),
    ...(build >= 9 ? { 'x-neurosol-utc-offset-minutes': '0' } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  return new Date(date.getTime() + amount * 24 * 60 * 60 * 1000);
}

async function csrfToken() {
  const response = await fetch(`${baseUrl}/admin/enrolments`, {
    headers: adminHeaders(),
  });
  assert.equal(response.status, 200);
  return (await response.text())
    .match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
}

async function enrolBuild9(patientId, displayName) {
  const issued = identityStore.issueEnrolmentCode({
    patientId,
    displayName,
    requireClinicalProfile: true,
  });
  const response = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: mobileHeaders(9, '', { json: true }),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function independentEntry({
  submissionId,
  patientId,
  date,
  createdAtUtc,
  entryDateSource,
}) {
  return {
    schemaVersion: 3,
    submissionId,
    patientId,
    patientName: 'Ignored client name',
    profileRevision: 1,
    profileDisorderIds: ['migraine'],
    profileDisorders: ['Migraine'],
    date,
    time: '19:00',
    wellnessPercent: 70,
    clientEntryVersion: 2,
    createdAtUtc,
    localUtcOffsetMinutes: 0,
    entryDateSource,
    records: [
      {
        track: 'Independent',
        disorderId: '',
        disorder: '',
        symptomId: 'headache',
        symptom: 'Headache',
        score: 4,
      },
    ],
  };
}

test('Build 9 is advertised without forcing Build 7 or Build 8', async () => {
  for (const build of [7, 8, 9]) {
    const config = await fetch(`${baseUrl}/api/mobile-config`, {
      headers: mobileHeaders(build),
    }).then(response => response.json());
    assert.equal(config.minimumBuild, 7);
    assert.equal(config.latestBuild, build);
    assert.equal(config.patientDiary, true);
    assert.equal(config.maximumBackdateDays, 7);
  }
});

test('portal stores a BP Patient ID and finds it without punctuation', async () => {
  const token = await csrfToken();
  assert.ok(token);
  const form = new URLSearchParams({
    csrfToken: token,
    patientId: '',
    formMode: 'create',
    displayName: 'Build Nine Patient',
    bpPatientId: 'BP-9001',
    schemaVersion: '3',
    profileModel: 'independent-v1',
    action: 'save',
  });
  form.append('disorderIds', 'migraine');
  form.append('symptomIds', 'headache');
  const saved = await fetch(`${baseUrl}/admin/enrolments/save-profile`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  assert.equal(saved.status, 200);
  const patient = Object.values(identityStore.snapshot().patients)
    .find(item => item.displayName === 'Build Nine Patient');
  assert.ok(patient);
  assert.equal(patient.bpPatientId, 'BP-9001');

  const search = await fetch(`${baseUrl}/admin/patient-search?q=bp9001`, {
    headers: adminHeaders(),
  });
  assert.equal(search.status, 200);
  const page = await search.text();
  assert.match(page, /Build Nine Patient/);
  assert.match(page, /BP-9001/);

  const unauthorised = await fetch(
    `${baseUrl}/admin/patient-search?q=bp9001`,
  );
  assert.equal(unauthorised.status, 401);
});

test('Build 9 accepts seven-day backdating and returns only its own diary', async () => {
  const patient = Object.values(identityStore.snapshot().patients)
    .find(item => item.displayName === 'Build Nine Patient');
  assert.ok(patient);
  const enrolment = await enrolBuild9(patient.patientId, patient.displayName);
  const createdAt = new Date();
  const today = isoDate(createdAt);
  const threeDaysAgo = isoDate(addDays(createdAt, -3));
  const eightDaysAgo = isoDate(addDays(createdAt, -8));

  for (const entry of [
    independentEntry({
      submissionId: 'build9-today',
      patientId: patient.patientId,
      date: today,
      createdAtUtc: createdAt.toISOString(),
      entryDateSource: 'today',
    }),
    independentEntry({
      submissionId: 'build9-backdated',
      patientId: patient.patientId,
      date: threeDaysAgo,
      createdAtUtc: createdAt.toISOString(),
      entryDateSource: 'backdated',
    }),
  ]) {
    const response = await fetch(`${baseUrl}/api/symptom-entry`, {
      method: 'POST',
      headers: mobileHeaders(9, enrolment.accessToken, { json: true }),
      body: JSON.stringify(entry),
    });
    assert.equal(response.status, 201);
  }

  const outOfRange = await fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: mobileHeaders(9, enrolment.accessToken, { json: true }),
    body: JSON.stringify(independentEntry({
      submissionId: 'build9-too-old',
      patientId: patient.patientId,
      date: eightDaysAgo,
      createdAtUtc: createdAt.toISOString(),
      entryDateSource: 'backdated',
    })),
  });
  assert.equal(outOfRange.status, 400);
  assert.equal((await outOfRange.json()).code, 'entry_date_out_of_range');

  const diary = await fetch(`${baseUrl}/api/diary?days=90`, {
    headers: mobileHeaders(9, enrolment.accessToken),
  });
  assert.equal(diary.status, 200);
  const body = await diary.json();
  assert.equal(body.maximumBackdateDays, 7);
  assert.deepEqual(
    body.entries.map(entry => entry.submissionId).sort(),
    ['build9-backdated', 'build9-today'],
  );
  assert.ok(body.entries.every(entry => entry.patientId === patient.patientId));

  const build8Attempt = await fetch(`${baseUrl}/api/diary?days=90`, {
    headers: mobileHeaders(8, enrolment.accessToken),
  });
  assert.equal(build8Attempt.status, 426);
  assert.equal((await build8Attempt.json()).minimumBuild, 9);
});
