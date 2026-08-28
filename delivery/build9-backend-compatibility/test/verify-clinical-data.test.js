'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  compareAfterMigration,
  requiredCsvColumns,
  snapshotData,
} = require('../Verify-ClinicalData');

function canonicalProfile() {
  return {
    schemaVersion: 2,
    primaryDisorderId: 'migraine',
    primaryDisorder: 'Migraine',
    primarySymptomIds: ['headache', 'nausea', 'fatigue'],
    primarySymptoms: ['Headache', 'Nausea', 'Fatigue'],
    secondaryDisorderId: null,
    secondaryDisorder: null,
    secondarySymptomIds: [],
    secondarySymptoms: [],
    revision: 1,
  };
}

function independentProfile() {
  return {
    schemaVersion: 3,
    disorderIds: ['migraine', 'dysautonomia'],
    disorders: ['Migraine', 'Dysautonomia'],
    symptomIds: ['headache', 'vertigo', 'weakness', 'pain'],
    symptoms: ['Headache', 'Vertigo', 'Weakness', 'Pain'],
    minimumAppBuild: 8,
    revision: 2,
  };
}

function writeFixture(directory, profile, columns = requiredCsvColumns) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'identity_store.json'), JSON.stringify({
    version: 4,
    patients: {
      'pt-test': {
        patientId: 'pt-test',
        displayName: 'Synthetic Patient',
        bpPatientId: 'BP-SECRET-9001',
        clinicalProfile: profile,
        clinicalProfileHistory: [profile],
      },
    },
    enrolmentCodes: { digest: { patientId: 'pt-test' } },
    devices: { token: { patientId: 'pt-test' } },
  }));
  fs.writeFileSync(
    path.join(directory, 'symptom_entries.csv'),
    `${columns.join(',')}\n${columns.map((_, index) => `value-${index}`).join(',')}\n`,
  );
  fs.writeFileSync(path.join(directory, 'disorder_catalog.json'), JSON.stringify({
    version: 3,
    customDisorders: {},
    customSymptoms: {},
    builtInDisorderSymptomOverrides: {},
    symptomIdAliases: {},
    auditLog: [],
  }));
}

test('snapshot contains counts but no patient identity fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-probe-'));
  try {
    writeFixture(directory, canonicalProfile());
    const snapshot = snapshotData(directory);
    assert.equal(snapshot.patientCount, 1);
    assert.equal(snapshot.bpPatientIdCount, 1);
    assert.equal(snapshot.deviceCount, 1);
    assert.equal(snapshot.csvDataRowCount, 1);
    assert.equal(snapshot.canonicalCurrentProfileCount, 1);
    assert.equal(JSON.stringify(snapshot).includes('Synthetic Patient'), false);
    assert.equal(JSON.stringify(snapshot).includes('pt-test'), false);
    assert.equal(JSON.stringify(snapshot).includes('BP-SECRET-9001'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('snapshot accepts an independent profile with at most six symptoms', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-probe-'));
  try {
    writeFixture(directory, independentProfile());
    const snapshot = snapshotData(directory);
    assert.equal(snapshot.currentProfileCount, 1);
    assert.equal(snapshot.canonicalCurrentProfileCount, 1);
    assert.doesNotThrow(() => compareAfterMigration(snapshot, snapshot));

    const invalid = independentProfile();
    invalid.symptomIds = [
      'headache',
      'nausea',
      'vertigo',
      'dizziness',
      'pain',
      'weakness',
      'fatigue',
    ];
    writeFixture(directory, invalid);
    const invalidSnapshot = snapshotData(directory);
    assert.throws(
      () => compareAfterMigration(invalidSnapshot, invalidSnapshot),
      /current profile lacks canonical identifiers/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('comparison rejects lost clinical rows or identities', () => {
  const before = {
    patientCount: 2,
    enrolmentCodeCount: 1,
    deviceCount: 1,
    activeDeviceCount: 1,
    currentProfileCount: 1,
    historicalProfileCount: 1,
    csvDataRowCount: 2,
    customDisorderCount: 0,
    customSymptomCount: 0,
    disorderAuditEventCount: 0,
  };
  const after = {
    ...before,
    patientCount: 1,
    identityStoreVersion: 4,
    canonicalCurrentProfileCount: 1,
    canonicalHistoricalProfileCount: 1,
    disorderCatalogPresent: true,
    disorderCatalogVersion: 3,
    csvColumns: requiredCsvColumns,
  };
  assert.throws(
    () => compareAfterMigration(before, after),
    /Patient count changed/,
  );
});

test('comparison requires canonical profiles and the complete CSV schema', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-probe-'));
  try {
    writeFixture(
      directory,
      {
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Nausea', 'Fatigue'],
      },
      requiredCsvColumns.filter(column => column !== 'PayloadSchemaVersion'),
    );
    const snapshot = snapshotData(directory);
    assert.throws(
      () => compareAfterMigration(snapshot, snapshot),
      /current profile lacks canonical identifiers/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('comparison permits a missing history entry to be recovered', () => {
  const before = {
    patientCount: 1,
    enrolmentCodeCount: 1,
    deviceCount: 1,
    activeDeviceCount: 1,
    currentProfileCount: 1,
    historicalProfileCount: 0,
    csvDataRowCount: 1,
    customDisorderCount: 0,
    customSymptomCount: 0,
    disorderAuditEventCount: 0,
  };
  const after = {
    ...before,
    historicalProfileCount: 1,
    identityStoreVersion: 4,
    canonicalCurrentProfileCount: 1,
    canonicalHistoricalProfileCount: 1,
    disorderCatalogPresent: true,
    disorderCatalogVersion: 3,
    csvColumns: requiredCsvColumns,
  };
  assert.doesNotThrow(() => compareAfterMigration(before, after));
});

test('comparison permits catalogue schema 1 to migrate to schema 3 without losing catalogue records', () => {
  const before = {
    patientCount: 1,
    enrolmentCodeCount: 1,
    deviceCount: 1,
    activeDeviceCount: 1,
    currentProfileCount: 1,
    historicalProfileCount: 1,
    csvDataRowCount: 1,
    customDisorderCount: 2,
    customSymptomCount: 0,
    disorderAuditEventCount: 5,
    disorderCatalogPresent: true,
    disorderCatalogVersion: 1,
  };
  const after = {
    ...before,
    identityStoreVersion: 4,
    canonicalCurrentProfileCount: 1,
    canonicalHistoricalProfileCount: 1,
    disorderCatalogVersion: 3,
    csvColumns: requiredCsvColumns,
  };

  assert.doesNotThrow(() => compareAfterMigration(before, after));
});

test('comparison permits guarded UUID symptom ID migration with one alias and audit event per ID', () => {
  const before = {
    patientCount: 1,
    enrolmentCodeCount: 1,
    deviceCount: 1,
    activeDeviceCount: 1,
    currentProfileCount: 1,
    historicalProfileCount: 1,
    csvDataRowCount: 1,
    customDisorderCount: 0,
    customSymptomCount: 2,
    legacyCustomSymptomIdCount: 2,
    symptomIdAliasCount: 0,
    disorderAuditEventCount: 4,
    disorderCatalogPresent: true,
    disorderCatalogVersion: 2,
  };
  const after = {
    ...before,
    identityStoreVersion: 4,
    canonicalCurrentProfileCount: 1,
    canonicalHistoricalProfileCount: 1,
    disorderCatalogVersion: 3,
    legacyCustomSymptomIdCount: 0,
    symptomIdAliasCount: 2,
    disorderAuditEventCount: 6,
    csvColumns: requiredCsvColumns,
  };

  assert.doesNotThrow(() => compareAfterMigration(before, after));
});
