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
process.env.ENABLE_CUSTOM_DISORDERS = 'true';
// The main suite lowers this only to preserve regression coverage for queued
// historical Build 6 data. Production startup separately enforces Build 7.
process.env.MIN_SUPPORTED_MOBILE_BUILD = '6';
process.env.LATEST_MOBILE_BUILD = '7';

const {
  app,
  disorderCatalog,
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

function build8Headers(accessToken = '', json = true) {
  return {
    ...build7Headers(accessToken, json),
    'x-neurosol-build': '8',
    'x-neurosol-disorders': 'canonical-v1',
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

async function post(
  body,
  accessToken = '',
  { clinicManaged = false, canonical = false } = {},
) {
  return fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: canonical
      ? build8Headers(accessToken)
      : clinicManaged
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
        MIN_SUPPORTED_MOBILE_BUILD: '7',
        LATEST_MOBILE_BUILD: '7',
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

test('mobile configuration keeps Build 7 supported when Build 8 is latest', () => {
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
          const base = 'http://127.0.0.1:' + port;
          const build7 = await fetch(base + '/api/mobile-config', {
            headers: {
              'x-neurosol-build': '7',
              'x-neurosol-profile': 'clinic-managed-v1',
            },
          });
          const build8 = await fetch(base + '/api/mobile-config', {
            headers: {
              'x-neurosol-build': '8',
              'x-neurosol-profile': 'clinic-managed-v1',
              'x-neurosol-disorders': 'canonical-v1',
            },
          });
          const enrolment = await fetch(base + '/api/enrol', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-neurosol-build': '7',
              'x-neurosol-profile': 'clinic-managed-v1',
            },
            body: JSON.stringify({ code: 'AAAAAAAAAAAA' }),
          });
          console.log('BUILD7=' + JSON.stringify(await build7.json()));
          console.log('BUILD8=' + JSON.stringify(await build8.json()));
          console.log('ENROLMENT=' + enrolment.status);
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
        LATEST_MOBILE_BUILD: '8',
      },
    },
  );
  fs.rmSync(configDataDir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BUILD7=.*"minimumBuild":7.*"latestBuild":7/);
  assert.match(result.stdout, /BUILD8=.*"minimumBuild":7.*"latestBuild":8/);
  assert.match(result.stdout, /ENROLMENT=404/);
});

test('production refuses to raise the global minimum above Build 7', () => {
  const configDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'neurosol-minimum-build-'),
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
        MIN_SUPPORTED_MOBILE_BUILD: '8',
        LATEST_MOBILE_BUILD: '8',
        IDENTITY_SECRET: 'valid-production-identity-secret-at-least-32-characters',
        ADMIN_PASSWORD: 'valid-production-admin-password',
      },
    },
  );
  fs.rmSync(configDataDir, { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must remain 7 while Build 7 is supported/,
  );
});

test('Build 7 CSV migration backs up and appends canonical IDs', () => {
  const migrationDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'neurosol-csv-migration-'),
  );
  try {
    const csvPath = path.join(migrationDir, 'symptom_entries.csv');
    fs.writeFileSync(
      csvPath,
      [
        'ReceivedAt,Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent,SubmissionId,PatientId,ProfileRevision',
        '2026-08-04T09:00:00.000Z,2026-08-04,19:00,Legacy Patient,Primary,Migraine,Headache,4,70,NS-legacy,pt-legacy,1',
        '2026-07-01T09:00:00.000Z,2026-07-01,19:00,Historical Patient,Primary,Dysautonomia,Sweating changes,5,60,NS-historical,pt-historical,1',
        '2026-06-20T09:00:00.000Z,2026-06-20,19:00,Historical Migraine,Primary,Migraine,Visual aura,3,70,NS-historical-aura,pt-historical-aura,2',
        '',
      ].join('\n'),
      'utf8',
    );
    const result = childProcess.spawnSync(
      process.execPath,
      ['-e', 'require("./server")'],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: '',
          DATA_DIR: migrationDir,
          IDENTITY_SECRET: 'migration-test-identity-secret-32-characters',
          ADMIN_PASSWORD: 'migration-test-admin-password',
          ENABLE_CUSTOM_DISORDERS: 'false',
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const migrated = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
    assert.match(migrated[0], /,DisorderId,SymptomId,PayloadSchemaVersion$/);
    assert.match(migrated[1], /,migraine,headache,1$/);
    assert.match(migrated[2], /,dysautonomia,sweating-changes,1$/);
    assert.match(migrated[3], /,migraine,visual-aura,1$/);
    assert.equal(
      fs.readdirSync(migrationDir)
        .filter(name => name.startsWith('symptom_entries.backup-')).length,
      1,
    );

    const secondRun = childProcess.spawnSync(
      process.execPath,
      ['-e', 'require("./server")'],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: '',
          DATA_DIR: migrationDir,
          IDENTITY_SECRET: 'migration-test-identity-secret-32-characters',
          ADMIN_PASSWORD: 'migration-test-admin-password',
          ENABLE_CUSTOM_DISORDERS: 'false',
        },
      },
    );
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(
      fs.readdirSync(migrationDir)
        .filter(name => name.startsWith('symptom_entries.backup-')).length,
      1,
    );
  } finally {
    fs.rmSync(migrationDir, { recursive: true, force: true });
  }
});

test('server startup refuses a corrupt disorder catalogue without rewriting it', () => {
  const corruptDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'neurosol-corrupt-catalog-'),
  );
  try {
    const catalogPath = path.join(corruptDir, 'disorder_catalog.json');
    const corruptText = '{"version":1,"customDisorders":{"broken":{}},"auditLog":[]}';
    fs.writeFileSync(catalogPath, corruptText, 'utf8');
    const result = childProcess.spawnSync(
      process.execPath,
      ['-e', 'require("./server")'],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: '',
          DATA_DIR: corruptDir,
          IDENTITY_SECRET: 'corrupt-test-identity-secret-at-least-32-characters',
          ADMIN_PASSWORD: 'corrupt-test-admin-password',
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /invalid record/);
    assert.equal(fs.readFileSync(catalogPath, 'utf8'), corruptText);
  } finally {
    fs.rmSync(corruptDir, { recursive: true, force: true });
  }
});

test('custom disorder assignment remains gated until explicitly enabled', () => {
  const gateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'neurosol-custom-gate-'),
  );
  try {
    const script = `
      const { createDisorderCatalogStore } = require('./disorder_catalog');
      const catalog = createDisorderCatalogStore({ dataDir: process.env.DATA_DIR });
      const custom = catalog.createCustomDisorder({
        displayName: 'Multiple system atrophy',
        confirmation: 'Multiple system atrophy',
      });
      const { app } = require('./server');
      const credentials = Buffer.from('gate-admin:gate-admin-password').toString('base64');
      const auth = { authorization: 'Basic ' + credentials };
      const server = app.listen(0, '127.0.0.1', async () => {
        try {
          const base = 'http://127.0.0.1:' + server.address().port;
          const page = await fetch(base + '/admin/enrolments', { headers: auth });
          const html = await page.text();
          const csrfToken = html.match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
          const form = new URLSearchParams({
            csrfToken,
            displayName: 'Gated Patient',
            primaryDisorderId: custom.id,
            action: 'save',
          });
          ['pain', 'dizziness', 'fatigue'].forEach(id => form.append('primarySymptomIds', id));
          const response = await fetch(base + '/admin/enrolments/save-profile', {
            method: 'POST',
            headers: {
              ...auth,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: form,
          });
          const body = await response.text();
          console.log('GATE_STATUS=' + response.status);
          console.log('GATE_MESSAGE=' + body.includes('disabled until Build 8 is available'));
        } finally {
          server.close();
        }
      });
    `;
    const result = childProcess.spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: '',
        DATA_DIR: gateDir,
        IDENTITY_SECRET: 'gate-test-identity-secret-at-least-32-characters',
        ADMIN_USER: 'gate-admin',
        ADMIN_PASSWORD: 'gate-admin-password',
        LATEST_MOBILE_BUILD: '7',
        MIN_SUPPORTED_MOBILE_BUILD: '7',
        ENABLE_CUSTOM_DISORDERS: 'false',
        REVIEW_ENROLMENT_CODE: '',
        REVIEW_PATIENT_ID_PREFIX: '',
        REVIEW_DISPLAY_NAME: '',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GATE_STATUS=400/);
    assert.match(result.stdout, /GATE_MESSAGE=true/);
  } finally {
    fs.rmSync(gateDir, { recursive: true, force: true });
  }
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

test('admin disorder creation requires CSRF, exact confirmation, and uniqueness', async () => {
  const pageResponse = await fetch(`${baseUrl}/admin/disorders`, {
    headers: adminHeaders(),
  });
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  const csrfToken = page.match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
  assert.ok(csrfToken);

  const mismatched = await fetch(`${baseUrl}/admin/disorders/create`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      displayName: 'Spinocerebellar ataxia',
      confirmation: 'Spinocerebellar Ataxia',
    }),
  });
  assert.equal(mismatched.status, 400);

  const created = await fetch(`${baseUrl}/admin/disorders/create`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      displayName: 'Spinocerebellar ataxia',
      confirmation: 'Spinocerebellar ataxia',
    }),
  });
  assert.equal(created.status, 201);
  assert.match(await created.text(), /Spinocerebellar ataxia/);

  const duplicate = await fetch(`${baseUrl}/admin/disorders/create`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      displayName: 'SPINOCEREBELLAR ATAXIA',
      confirmation: 'SPINOCEREBELLAR ATAXIA',
    }),
  });
  assert.equal(duplicate.status, 400);
  assert.match(await duplicate.text(), /already exists/);
});

test('an active Build 7 device blocks a Build 8-only profile assignment', async () => {
  const custom = disorderCatalog.createCustomDisorder({
    displayName: 'Progressive supranuclear palsy',
    confirmation: 'Progressive supranuclear palsy',
    actor: 'test-admin',
  });
  const identity = await enrolClinicManaged({
    patientId: 'pt-build7-custom-guard',
    displayName: 'Build Seven Guard',
  });
  const page = await fetch(`${baseUrl}/admin/enrolments`, {
    headers: adminHeaders(),
  });
  const csrfToken = (await page.text())
    .match(/name="csrfToken" value="([a-f0-9]+)"/)?.[1];
  const profileForm = () => {
    const form = new URLSearchParams({
      csrfToken,
      patientId: identity.patientId,
      displayName: 'Build Seven Guard',
      primaryDisorderId: custom.id,
      action: 'save',
    });
    ['pain', 'dizziness', 'fatigue'].forEach(id =>
      form.append('primarySymptomIds', id)
    );
    return form;
  };
  const blocked = await fetch(
    `${baseUrl}/admin/enrolments/save-profile`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: profileForm(),
    },
  );
  assert.equal(blocked.status, 400);
  assert.match(await blocked.text(), /active Build 7 or unconfirmed device/);

  const observedUpgrade = await fetch(`${baseUrl}/api/profile`, {
    headers: build8Headers(identity.accessToken, false),
  });
  assert.equal(observedUpgrade.status, 200);

  const accepted = await fetch(
    `${baseUrl}/admin/enrolments/save-profile`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: profileForm(),
    },
  );
  assert.equal(accepted.status, 200);
  assert.equal(
    identityStore.patientClinicalProfile(identity.patientId)
      .primaryDisorderId,
    custom.id,
  );
});

test('custom profiles require Build 8 and submissions receive canonical IDs', async () => {
  const custom = disorderCatalog.createCustomDisorder({
    displayName: 'Multiple sclerosis',
    confirmation: 'Multiple sclerosis',
    actor: 'test-admin',
  });
  const saved = identityStore.saveClinicalProfile({
    patientId: 'pt-custom-disorder',
    displayName: 'Custom Disorder Patient',
    clinicalProfile: {
      primaryDisorderId: custom.id,
      primarySymptomIds: ['pain', 'dizziness', 'fatigue'],
    },
  });
  const issued = identityStore.issueEnrolmentCode({
    patientId: saved.patientId,
    displayName: saved.displayName,
    requireClinicalProfile: true,
  });

  const build7Attempt = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build7Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(build7Attempt.status, 426);
  assert.equal((await build7Attempt.json()).minimumBuild, 8);
  assert.equal(
    Object.values(identityStore.snapshot().enrolmentCodes)
      .find(record => record.patientId === saved.patientId)?.usedAt,
    null,
  );

  const missingCapabilityAttempt = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: {
      ...build7Headers(),
      'x-neurosol-build': '8',
    },
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(missingCapabilityAttempt.status, 426);
  assert.equal(
    Object.values(identityStore.snapshot().enrolmentCodes)
      .find(record => record.patientId === saved.patientId)?.usedAt,
    null,
  );

  const build8Attempt = await fetch(`${baseUrl}/api/enrol`, {
    method: 'POST',
    headers: build8Headers(),
    body: JSON.stringify({ code: issued.code }),
  });
  assert.equal(build8Attempt.status, 200);
  const identity = await build8Attempt.json();
  assert.equal(identity.clinicalProfile.primaryDisorderId, custom.id);
  assert.equal(identity.clinicalProfile.minimumAppBuild, 8);

  const oldProfileRequest = await fetch(`${baseUrl}/api/profile`, {
    headers: build7Headers(identity.accessToken, false),
  });
  assert.equal(oldProfileRequest.status, 426);
  const profileRequest = await fetch(`${baseUrl}/api/profile`, {
    headers: build8Headers(identity.accessToken, false),
  });
  assert.equal(profileRequest.status, 200);

  const submission = {
    schemaVersion: 2,
    submissionId: 'NS-custom-canonical',
    patientId: saved.patientId,
    patientName: 'Untrusted Name',
    date: '2026-08-04',
    time: '19:00',
    wellnessPercent: 70,
    profileRevision: saved.clinicalProfile.revision,
    records: [
      {
        track: 'Primary',
        disorderId: custom.id,
        disorder: 'Multiple sclerosis',
        symptomId: 'pain',
        symptom: 'Pain',
        score: 4,
      },
      {
        track: 'Primary',
        disorderId: custom.id,
        disorder: 'Multiple sclerosis',
        symptomId: 'dizziness',
        symptom: 'Dizziness',
        score: 3,
      },
      {
        track: 'Primary',
        disorderId: custom.id,
        disorder: 'Multiple sclerosis',
        symptomId: 'fatigue',
        symptom: 'Fatigue',
        score: 5,
      },
    ],
  };
  const accepted = await post(
    submission,
    identity.accessToken,
    { canonical: true },
  );
  assert.equal(accepted.status, 201);

  const idsOnly = structuredClone(submission);
  idsOnly.submissionId = 'NS-custom-ids-only';
  idsOnly.date = '2026-08-05';
  idsOnly.records = idsOnly.records.map(record => ({
    track: record.track,
    disorderId: record.disorderId,
    symptomId: record.symptomId,
    score: record.score,
  }));
  const acceptedIdsOnly = await post(
    idsOnly,
    identity.accessToken,
    { canonical: true },
  );
  assert.equal(acceptedIdsOnly.status, 201);

  const mismatched = structuredClone(submission);
  mismatched.submissionId = 'NS-custom-wrong-id';
  mismatched.date = '2026-08-06';
  mismatched.records[0].symptomId = 'weakness';
  const rejected = await post(
    mismatched,
    identity.accessToken,
    { canonical: true },
  );
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, 'assigned_profile_mismatch');

  const csv = fs.readFileSync(
    path.join(testDataDir, 'symptom_entries.csv'),
    'utf8',
  );
  assert.match(
    csv.split('\n')[0],
    /,DisorderId,SymptomId,PayloadSchemaVersion$/,
  );
  assert.equal(
    csv.split('\n').filter(line => line.includes('NS-custom-canonical'))
      .every(line => line.includes(`,${custom.id},`)),
    true,
  );

  disorderCatalog.updateCustomDisorder({
    id: custom.id,
    displayName: 'Multiple sclerosis (MS)',
    confirmation: 'Multiple sclerosis (MS)',
    actor: 'test-admin',
  });
  const refreshedProfiles = identityStore.refreshProfilesForDisorder(custom.id);
  assert.equal(refreshedProfiles, 1);
  assert.equal(
    identityStore.patientClinicalProfile(saved.patientId).primaryDisorder,
    'Multiple sclerosis (MS)',
  );
  assert.equal(
    identityStore.patientClinicalProfile(saved.patientId).revision,
    saved.clinicalProfile.revision + 1,
  );
  const population = await fetch(
    `${baseUrl}/admin/population?disorderId=${encodeURIComponent(custom.id)}`,
    { headers: adminHeaders() },
  );
  assert.equal(population.status, 200);
  assert.match(await population.text(), /Multiple sclerosis \(MS\)/);
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
  const build7Rows = csv.split('\n').filter(line =>
    line.includes('NS-clinic-profile-accepted')
  );
  assert.equal(build7Rows.length, 3);
  assert.equal(build7Rows.every(line => /,migraine,[^,]+,1$/.test(line)), true);
  const observedDevice = Object.values(identityStore.snapshot().devices)
    .find(device => device.patientId === identity.patientId);
  assert.equal(observedDevice.lastMobileBuild, 7);
  assert.equal(observedDevice.lastPayloadSchemaVersion, 1);
});

test('schema 2 is additive and requires a canonical-capable Build 8 client', async () => {
  const identity = await enrolClinicManaged({
    patientId: 'pt-schema-compatibility',
    displayName: 'Schema Compatibility',
  });
  const body = validSubmission({
    submissionId: 'NS-schema-two',
    patientId: identity.patientId,
    date: '2026-08-07',
  });
  body.profileRevision = identity.saved.clinicalProfile.revision;
  body.schemaVersion = 2;
  const symptomIds = {
    Headache: 'headache',
    Nausea: 'nausea',
    Fatigue: 'fatigue',
  };
  body.records = body.records.map(record => ({
    ...record,
    disorderId: 'migraine',
    symptomId: symptomIds[record.symptom],
  }));

  const build7Rejected = await post(
    body,
    identity.accessToken,
    { clinicManaged: true },
  );
  assert.equal(build7Rejected.status, 426);
  assert.equal((await build7Rejected.json()).minimumBuild, 8);

  const invalidSchema = structuredClone(body);
  invalidSchema.schemaVersion = 3;
  const invalidResponse = await post(
    invalidSchema,
    identity.accessToken,
    { canonical: true },
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).code, 'invalid_schema_version');

  const missingSchema = validSubmission({
    submissionId: 'NS-schema-missing-build8',
    patientId: identity.patientId,
    date: '2026-08-08',
  });
  missingSchema.profileRevision = identity.saved.clinicalProfile.revision;
  const missingSchemaAccepted = await post(
    missingSchema,
    identity.accessToken,
    { canonical: true },
  );
  assert.equal(missingSchemaAccepted.status, 201);
  assert.equal((await missingSchemaAccepted.json()).payloadSchemaVersion, 1);

  const build8Accepted = await post(
    body,
    identity.accessToken,
    { canonical: true },
  );
  assert.equal(build8Accepted.status, 201);
  assert.equal((await build8Accepted.json()).payloadSchemaVersion, 2);
  const observedDevice = Object.values(identityStore.snapshot().devices)
    .find(device => device.patientId === identity.patientId);
  assert.equal(observedDevice.lastMobileBuild, 8);
  assert.equal(observedDevice.lastPayloadSchemaVersion, 2);
  assert.equal(observedDevice.supportsCanonicalDisorders, true);
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
      .every(row => row.split(',')[11] === '1'),
    true,
  );
  assert.equal(
    rows.filter(row => row.includes('NS-profile-history-queued'))
      .every(row => row.split(',')[11] === '2'),
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

  const changedRetry = structuredClone(body);
  changedRetry.records[0].score = 9;
  const conflict = await post(changedRetry, identity.accessToken);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'submission_id_conflict');

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
