const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurotracker-'));
process.env.DATA_DIR = testDataDir;
process.env.API_KEY = 'test-api-key';
process.env.ADMIN_PASSWORD = 'test-admin-password';

const { app } = require('../server');
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

function validSubmission() {
  return {
    submissionId: 'NT-test-001',
    patientId: 'pt-test-001',
    patientName: 'Synthetic Patient',
    date: '2026-07-17',
    time: '19:00',
    wellnessPercent: 70,
    records: [
      { track: 'Primary', disorder: 'Migraine', symptom: 'Headache', score: 4 },
      { track: 'Primary', disorder: 'Migraine', symptom: 'Nausea', score: 2 },
      { track: 'Primary', disorder: 'Migraine', symptom: 'Fatigue', score: 5 },
    ],
  };
}

async function post(body, apiKey = 'test-api-key') {
  return fetch(`${baseUrl}/api/symptom-entry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
}

test('rejects unauthenticated uploads', async () => {
  const response = await post(validSubmission(), 'wrong-key');
  assert.equal(response.status, 401);
});

test('rejects missing symptom scores', async () => {
  const body = validSubmission();
  body.records.pop();
  const response = await post(body);
  assert.equal(response.status, 400);
});

test('stores a submission only once', async () => {
  const first = await post(validSubmission());
  assert.equal(first.status, 201);
  assert.equal((await first.json()).duplicate, false);

  const retry = await post(validSubmission());
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);

  const csv = fs.readFileSync(path.join(testDataDir, 'symptom_entries.csv'), 'utf8');
  assert.equal(csv.split('\n').filter(line => line.includes('NT-test-001')).length, 3);
});
