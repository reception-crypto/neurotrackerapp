'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDisorderCatalogStore } = require('../disorder_catalog');
const { createIdentityStore } = require('../identity_store');

const secret = 'test-only-identity-secret-at-least-32-characters';

function legacyStore(profile) {
  return {
    version: 2,
    patients: {
      'pt-legacy-profile': {
        patientId: 'pt-legacy-profile',
        displayName: 'Legacy Profile',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        clinicalProfile: profile,
      },
    },
    enrolmentCodes: {},
    devices: {},
  };
}

test('legacy profile migration adds canonical IDs and makes a backup once', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    fs.writeFileSync(
      path.join(dataDir, 'identity_store.json'),
      `${JSON.stringify(legacyStore({
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
        secondaryDisorder: null,
        secondarySymptoms: [],
        revision: 4,
        updatedAt: '2026-07-01T00:00:00.000Z',
      }), null, 2)}\n`,
      'utf8',
    );
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
      now: () => new Date('2026-08-04T01:02:03.000Z'),
    });
    const migrated = identityStore.migrateCanonicalProfiles();
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.migratedProfiles, 1);
    assert.equal(fs.existsSync(migrated.backupPath), true);

    const profile = identityStore.snapshot()
      .patients['pt-legacy-profile'].clinicalProfile;
    assert.equal(profile.revision, 4);
    assert.equal(profile.primaryDisorderId, 'migraine');
    assert.deepEqual(
      profile.primarySymptomIds,
      ['headache', 'nausea', 'vomiting'],
    );
    assert.equal(profile.minimumAppBuild, 7);

    const secondPass = identityStore.migrateCanonicalProfiles();
    assert.equal(secondPass.migrated, false);
    assert.equal(
      fs.readdirSync(path.join(dataDir, 'backups')).length,
      1,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('an unresolvable legacy profile aborts migration without changing data', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const identityPath = path.join(dataDir, 'identity_store.json');
    const original = `${JSON.stringify(legacyStore({
      primaryDisorder: 'Unregistered condition',
      primarySymptoms: ['Pain', 'Dizziness', 'Fatigue'],
      secondaryDisorder: null,
      secondarySymptoms: [],
      revision: 1,
      updatedAt: '2026-07-01T00:00:00.000Z',
    }), null, 2)}\n`;
    fs.writeFileSync(identityPath, original, 'utf8');
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    assert.throws(
      () => identityStore.migrateCanonicalProfiles(),
      /Primary disorder is not supported/,
    );
    assert.equal(fs.readFileSync(identityPath, 'utf8'), original);
    assert.equal(fs.existsSync(path.join(dataDir, 'backups')), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('retired symptoms migrate without becoming selectable again', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    fs.writeFileSync(
      path.join(dataDir, 'identity_store.json'),
      `${JSON.stringify(legacyStore({
        primaryDisorder: 'Dysautonomia',
        primarySymptoms: ['Dizziness', 'Sweating changes', 'Fatigue'],
        secondaryDisorder: null,
        secondarySymptoms: [],
        revision: 2,
        updatedAt: '2026-07-01T00:00:00.000Z',
      }), null, 2)}\n`,
      'utf8',
    );
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    identityStore.migrateCanonicalProfiles();
    const profile = identityStore.snapshot()
      .patients['pt-legacy-profile'].clinicalProfile;
    assert.deepEqual(
      profile.primarySymptomIds,
      ['dizziness', 'sweating-changes', 'fatigue'],
    );
    assert.throws(
      () => identityStore.saveClinicalProfile({
        patientId: 'pt-new-retired-profile',
        displayName: 'Retired Symptom Test',
        clinicalProfile: {
          primaryDisorder: 'Dysautonomia',
          primarySymptoms: ['Dizziness', 'Sweating changes', 'Fatigue'],
        },
      }),
      /do not match/,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reconciliation adds a revision without rewriting historical names', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const disorderCatalog = createDisorderCatalogStore({
      dataDir,
      now: () => new Date('2026-08-04T01:00:00.000Z'),
    });
    const custom = disorderCatalog.createCustomDisorder({
      displayName: 'Multiple sclerosis',
      confirmation: 'Multiple sclerosis',
    });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
      now: () => new Date('2026-08-04T02:00:00.000Z'),
    });
    const saved = identityStore.saveClinicalProfile({
      patientId: 'pt-custom-rename',
      displayName: 'Custom Rename',
      clinicalProfile: {
        primaryDisorderId: custom.id,
        primarySymptomIds: ['pain', 'dizziness', 'fatigue'],
      },
    });
    disorderCatalog.updateCustomDisorder({
      id: custom.id,
      displayName: 'Multiple sclerosis (MS)',
      confirmation: 'Multiple sclerosis (MS)',
    });

    assert.equal(identityStore.migrateCanonicalProfiles().migrated, false);
    assert.equal(identityStore.reconcileCurrentProfiles(), 1);
    const patient = identityStore.snapshot().patients['pt-custom-rename'];
    assert.equal(patient.clinicalProfile.revision, saved.clinicalProfile.revision + 1);
    assert.equal(patient.clinicalProfile.primaryDisorder, 'Multiple sclerosis (MS)');
    assert.equal(patient.clinicalProfileHistory[0].primaryDisorder, 'Multiple sclerosis');
    assert.equal(identityStore.migrateCanonicalProfiles().migrated, false);
    assert.equal(identityStore.reconcileCurrentProfiles(), 0);
    assert.equal(
      identityStore.snapshot().patients['pt-custom-rename']
        .clinicalProfileHistory[0].primaryDisorder,
      'Multiple sclerosis',
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('device compatibility observations retain Build 7 traffic evidence', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    const issued = identityStore.issueEnrolmentCode({
      patientId: 'pt-build7-observation',
      displayName: 'Build Seven Observation',
    });
    const enrolled = identityStore.redeemEnrolmentCode(issued.code, {
      supportedMobileBuild: 7,
      supportsClinicManagedProfile: true,
      supportsCanonicalDisorders: false,
    });
    assert.equal(enrolled.status, 'ok');
    assert.ok(identityStore.authenticate(enrolled.accessToken, {
      mobileBuild: 7,
      supportsClinicManagedProfile: true,
      supportsCanonicalDisorders: false,
    }));
    assert.equal(identityStore.recordPayloadSchema(enrolled.accessToken, 1), true);
    assert.deepEqual(identityStore.compatibilitySummary(), {
      activeDevices: 1,
      builds: { 7: 1 },
      payloadSchemas: { 1: 1 },
      canonicalDevices: 0,
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
