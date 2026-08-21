'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'neurosol-independent-'),
);
process.env.DATA_DIR = testDataDir;
process.env.IDENTITY_SECRET =
  'independent-test-identity-secret-at-least-32-characters';
process.env.ADMIN_USER = 'independent-admin';
process.env.ADMIN_PASSWORD = 'independent-admin-password';
process.env.MIN_SUPPORTED_MOBILE_BUILD = '7';
process.env.LATEST_MOBILE_BUILD = '7';
process.env.ENABLE_CUSTOM_DISORDERS = 'true';
process.env.ENABLE_INDEPENDENT_PROFILES = 'true';
process.env.REVIEW_ENROLMENT_CODE = '';
process.env.REVIEW_PATIENT_ID_PREFIX = '';
process.env.REVIEW_DISPLAY_NAME = '';

const {
  app,
  csvPath,
  identityStore,
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

function adminHeaders() {
  const credentials = Buffer.from(
    'independent-admin:independent-admin-password',
  ).toString('base64');
  return { authorization: `Basic ${credentials}` };
}

function build7Headers(accessToken = '', json = true) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-neurosol-build': '7',
    'x-neurosol-profile': 'clinic-managed-v1',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

function build8Headers(
  accessToken = '',
  { independent = true, json = true } = {},
) {
  return {
    ...build7Headers(accessToken, json),
    'x-neurosol-build': '8',
    'x-neurosol-disorders': 'canonical-v1',
    ...(independent
      ? { 'x-neurosol-profile-model': 'independent-v1' }
      : {}),
  };
}

async function csrfToken() {
  const response = await fetch(`${baseUrl}/admin/enrolments`, {
    headers: adminHeaders(),
  });
  assert.equal(response.status, 200);
  return (await response.text())
    .match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
}

function independentForm({
  token,
  patientId = '',
  displayName,
  disorderIds,
  symptomIds,
}) {
  const form = new URLSearchParams({
    csrfToken: token,
    patientId,
    formMode: patientId ? 'edit' : 'create',
    displayName,
    schemaVersion: '3',
    profileModel: 'independent-v1',
    action: 'save',
  });
  disorderIds.forEach(id => form.append('disorderIds', id));
  symptomIds.forEach(id => form.append('symptomIds', id));
  return form;
}

async function saveIndependentProfile(options) {
  return fetch(`${baseUrl}/admin/enrolments/save-profile`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: independentForm(options),
  });
}

test('mobile configuration advertises the gated independent model safely', async () => {
  const build7 = await fetch(`${baseUrl}/api/mobile-config`, {
    headers: build7Headers('', false),
  }).then(response => response.json());
  assert.equal(build7.minimumBuild, 7);
  assert.equal(build7.build7Supported, true);
  assert.equal(build7.independentProfileModel, true);
  assert.equal(build7.independentProfilesEnabled, true);
  assert.equal(build7.maximumProfileSymptoms, 6);
  assert.equal(build7.preferredPayloadSchemaVersion, 1);

  const canonicalOnly = await fetch(`${baseUrl}/api/mobile-config`, {
    headers: build8Headers('', { independent: false, json: false }),
  }).then(response => response.json());
  assert.equal(canonicalOnly.preferredPayloadSchemaVersion, 2);

  const independent = await fetch(`${baseUrl}/api/mobile-config`, {
    headers: build8Headers('', { json: false }),
  }).then(response => response.json());
  assert.equal(independent.preferredPayloadSchemaVersion, 3);
});

test('staff select disorders and one to six symptoms from separate lists', async () => {
  const token = await csrfToken();
  assert.ok(token);
  const page = await fetch(`${baseUrl}/admin/enrolments`, {
    headers: adminHeaders(),
  }).then(response => response.text());
  assert.match(page, /independently select/);
  assert.match(page, /between 1 and 6 symptoms/);
  assert.match(page, /name="disorderIds"/);
  assert.match(page, /name="symptomIds"/);
  assert.doesNotMatch(page, /name="primarySymptomIds"/);

  const response = await saveIndependentProfile({
    token,
    displayName: 'Independent Portal Patient',
    disorderIds: ['migraine', 'dysautonomia'],
    // Weakness is deliberately valid with Migraine because the lists are
    // independent in schema 3.
    symptomIds: ['headache', 'weakness', 'vertigo', 'pain'],
  });
  assert.equal(response.status, 200);
  const patient = Object.values(identityStore.snapshot().patients)
    .find(item => item.displayName === 'Independent Portal Patient');
  assert.ok(patient);
  assert.equal(patient.clinicalProfile.schemaVersion, 3);
  assert.deepEqual(
    patient.clinicalProfile.disorderIds,
    ['migraine', 'dysautonomia'],
  );
  assert.deepEqual(
    patient.clinicalProfile.symptomIds,
    ['headache', 'weakness', 'vertigo', 'pain'],
  );

  const tooMany = await saveIndependentProfile({
    token,
    displayName: 'Too Many Symptoms',
    disorderIds: ['migraine'],
    symptomIds: [
      'headache',
      'nausea',
      'vertigo',
      'dizziness',
      'pain',
      'weakness',
      'fatigue',
    ],
  });
  assert.equal(tooMany.status, 400);
  assert.match(await tooMany.text(), /between 1 and 6 symptoms/);
  assert.equal(
    Object.values(identityStore.snapshot().patients)
      .some(item => item.displayName === 'Too Many Symptoms'),
    false,
  );
});

test('schema 3 enrolment requires the independent Build 8 capability', async () => {
  const patient = Object.values(identityStore.snapshot().patients)
    .find(item => item.displayName === 'Independent Portal Patient');
  assert.ok(patient);
  const issued = identityStore.issueEnrolmentCode({
    patientId: patient.patientId,
    displayName: patient.displayName,
    requireClinicalProfile: true,
  });

  const build7 = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(build7.status, 426);

  const canonicalOnly = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build8Headers('', { independent: false }),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(canonicalOnly.status, 426);

  const accepted = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build8Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(accepted.status, 200);
  const identity = await accepted.json();
  assert.equal(identity.clinicalProfile.schemaVersion, 3);
  assert.equal(identity.clinicalProfile.symptomIds.length, 4);
});

test('schema 3 stores one row per symptom with profile disorder snapshots', async () => {
  const patient = Object.values(identityStore.snapshot().patients)
    .find(item => item.displayName === 'Independent Portal Patient');
  const device = Object.values(identityStore.snapshot().devices)
    .find(item => item.patientId === patient.patientId && !item.revokedAt);
  assert.ok(device);

  // The plaintext token is intentionally not in the store, so obtain a fresh
  // recovery enrolment after revoking the first synthetic test device.
  identityStore.revokePatientDevices(patient.patientId);
  const issued = identityStore.issueEnrolmentCode({
    patientId: patient.patientId,
    displayName: patient.displayName,
    requireClinicalProfile: true,
  });
  const enrolment = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build8Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  const identity = await enrolment.json();
  assert.equal(enrolment.status, 200);

  const body = {
    schemaVersion: 3,
    submissionId: 'NS-independent-submission',
    patientId: patient.patientId,
    date: '2026-08-14',
    time: '19:00',
    wellnessPercent: 70,
    profileRevision: patient.clinicalProfile.revision,
    records: patient.clinicalProfile.symptomIds.map((symptomId, index) => ({
      track: 'Independent',
      symptomId,
      score: index + 1,
    })),
  };
  const accepted = await fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: build8Headers(identity.accessToken),
    body: JSON.stringify(body),
  });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).payloadSchemaVersion, 3);

  const exactRetry = await fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: build8Headers(identity.accessToken),
    body: JSON.stringify(body),
  });
  assert.equal(exactRetry.status, 200);
  assert.equal((await exactRetry.json()).duplicate, true);

  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  assert.match(
    lines[0],
    /,PayloadSchemaVersion,ProfileDisorderIds,ProfileDisorders$/,
  );
  const rows = lines
    .filter(line => line.includes('NS-independent-submission'))
    .map(line => line.split(','));
  assert.equal(rows.length, 4);
  assert.equal(rows.every(row => row[4] === 'Independent'), true);
  assert.equal(rows.every(row => row[5] === '' && row[12] === ''), true);
  assert.equal(rows.every(row => row[14] === '3'), true);
  assert.equal(
    rows.every(row => row[15] === 'migraine|dysautonomia'),
    true,
  );
  assert.equal(
    rows.every(row => row[16] === 'Migraine|Dysautonomia'),
    true,
  );

  for (const disorderId of ['migraine', 'dysautonomia']) {
    const portal = await fetch(
      `${baseUrl}/admin?patientId=${patient.patientId}&disorderId=${disorderId}`,
      { headers: adminHeaders() },
    );
    assert.equal(portal.status, 200);
    const html = await portal.text();
    assert.match(html, /Independent Portal Patient/);
    assert.match(html, /Headache/);
    assert.match(html, /Weakness/);
  }

  const tooMany = structuredClone(body);
  tooMany.submissionId = 'NS-independent-too-many';
  tooMany.date = '2026-08-15';
  tooMany.records = [
    'headache',
    'nausea',
    'vertigo',
    'dizziness',
    'pain',
    'weakness',
    'fatigue',
  ].map((symptomId, index) => ({
    track: 'Independent',
    symptomId,
    score: index % 11,
  }));
  const rejected = await fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: build8Headers(identity.accessToken),
    body: JSON.stringify(tooMany),
  });
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /Between one and 6/);

  const duplicateSymptom = structuredClone(body);
  duplicateSymptom.submissionId = 'NS-independent-duplicate-symptom';
  duplicateSymptom.date = '2026-08-16';
  duplicateSymptom.records[1].symptomId =
    duplicateSymptom.records[0].symptomId;
  const duplicateRejected = await fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: build8Headers(identity.accessToken),
    body: JSON.stringify(duplicateSymptom),
  });
  assert.equal(duplicateRejected.status, 400);
  assert.match(await duplicateRejected.text(), /must be unique/);
});

test('Build 7 nested profiles remain usable while independent mode is enabled', async () => {
  const saved = identityStore.saveClinicalProfile({
    patientId: 'pt-build7-independent-gate',
    displayName: 'Build Seven Compatibility',
    clinicalProfile: {
      primaryDisorderId: 'migraine',
      primarySymptomIds: ['headache', 'nausea', 'vomiting'],
    },
  });
  const issued = identityStore.issueEnrolmentCode({
    patientId: saved.patientId,
    displayName: saved.displayName,
    requireClinicalProfile: true,
  });
  const enrolment = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(enrolment.status, 200);
  const identity = await enrolment.json();
  assert.equal(identity.clinicalProfile.schemaVersion, 2);

  const submission = await fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: build7Headers(identity.accessToken),
    body: JSON.stringify({
      submissionId: 'NS-build7-compatible',
      patientId: saved.patientId,
      date: '2026-08-14',
      time: '19:00',
      wellnessPercent: 80,
      profileRevision: saved.clinicalProfile.revision,
      records: [
        {
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Headache',
          score: 2,
        },
        {
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Nausea',
          score: 1,
        },
        {
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Vomiting',
          score: 0,
        },
      ],
    }),
  });
  assert.equal(submission.status, 201);
  assert.equal((await submission.json()).payloadSchemaVersion, 1);

  const token = await csrfToken();
  const legacyPage = await fetch(
    `${baseUrl}/admin/enrolments?editPatientId=${saved.patientId}&profileMode=legacy`,
    { headers: adminHeaders() },
  ).then(response => response.text());
  assert.match(legacyPage, /Build 7 compatibility editor/);
  assert.match(legacyPage, /name="primarySymptomIds"/);

  const legacyForm = new URLSearchParams({
    csrfToken: token,
    patientId: saved.patientId,
    formMode: 'edit',
    displayName: saved.displayName,
    profileModel: 'legacy-v1',
    primaryDisorderId: 'migraine',
    action: 'save',
  });
  ['headache', 'nausea', 'fatigue'].forEach(id =>
    legacyForm.append('primarySymptomIds', id)
  );
  const maintained = await fetch(
    `${baseUrl}/admin/enrolments/save-profile`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: legacyForm,
    },
  );
  assert.equal(maintained.status, 200);
  assert.equal(
    identityStore.patientClinicalProfile(saved.patientId).schemaVersion,
    2,
  );
  assert.equal(
    identityStore.patientClinicalProfile(saved.patientId).revision,
    2,
  );

  const upgradeForm = {
    token,
    patientId: saved.patientId,
    displayName: saved.displayName,
    disorderIds: ['migraine', 'dysautonomia'],
    symptomIds: ['headache', 'nausea', 'weakness'],
  };
  const blocked = await saveIndependentProfile(upgradeForm);
  assert.equal(blocked.status, 400);
  assert.match(await blocked.text(), /active Build 7 or unconfirmed device/);

  const observedOnBuild8 = await fetch(`${baseUrl}/api/profile`, {
    headers: build8Headers(identity.accessToken, { json: false }),
  });
  assert.equal(observedOnBuild8.status, 200);
  const upgraded = await saveIndependentProfile(upgradeForm);
  assert.equal(upgraded.status, 200);
  assert.equal(
    identityStore.patientClinicalProfile(saved.patientId).schemaVersion,
    3,
  );
});
