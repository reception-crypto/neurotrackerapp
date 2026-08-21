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

test('retired Migraine Visual aura remains valid for a Build 7 profile revision', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    fs.writeFileSync(
      path.join(dataDir, 'identity_store.json'),
      `${JSON.stringify(legacyStore({
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Visual aura', 'Dizziness'],
        secondaryDisorder: null,
        secondarySymptoms: [],
        revision: 5,
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
    assert.equal(profile.revision, 5);
    assert.deepEqual(
      profile.primarySymptomIds,
      ['headache', 'visual-aura', 'dizziness'],
    );
    assert.throws(
      () => identityStore.saveClinicalProfile({
        patientId: 'pt-new-visual-aura-profile',
        displayName: 'Retired Visual Aura Test',
        clinicalProfile: {
          primaryDisorder: 'Migraine',
          primarySymptoms: ['Headache', 'Visual aura', 'Dizziness'],
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

test('renaming a custom symptom creates a new current profile revision and preserves history', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const customSymptom = disorderCatalog.createCustomSymptom({
      displayName: 'Limb heaviness',
      confirmation: 'Limb heaviness',
    });
    const migraine = disorderCatalog.findDisorder({ id: 'migraine' });
    disorderCatalog.setDisorderSymptoms({
      disorderId: 'migraine',
      symptomIds: [...migraine.allowedSymptomIds, customSymptom.id],
    });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    const saved = identityStore.saveClinicalProfile({
      patientId: 'pt-custom-symptom-rename',
      displayName: 'Custom Symptom Rename',
      clinicalProfile: {
        primaryDisorderId: 'migraine',
        primarySymptomIds: ['headache', 'nausea', customSymptom.id],
      },
    });

    disorderCatalog.updateCustomSymptom({
      id: customSymptom.id,
      displayName: 'Heavy limb sensation',
      confirmation: 'Heavy limb sensation',
    });
    assert.equal(identityStore.refreshProfilesForSymptom(customSymptom.id), 1);

    const patient = identityStore.snapshot()
      .patients['pt-custom-symptom-rename'];
    assert.equal(
      patient.clinicalProfile.revision,
      saved.clinicalProfile.revision + 1,
    );
    assert.deepEqual(
      patient.clinicalProfile.primarySymptoms,
      ['Headache', 'Nausea', 'Heavy limb sensation'],
    );
    assert.deepEqual(
      patient.clinicalProfileHistory[0].primarySymptoms,
      ['Headache', 'Nausea', 'Limb heaviness'],
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
      independentProfileDevices: 0,
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('collided codes recover into separate identities and replace the shared PatientId', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    let clock = new Date('2026-08-21T01:00:00.000Z');
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
      now: () => clock,
    });
    const first = identityStore.saveClinicalProfile({
      patientId: 'pt-collided-identity',
      displayName: 'First Visible Name',
      clinicalProfile: {
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
        secondaryDisorder: null,
        secondarySymptoms: [],
      },
    });
    const firstCode = identityStore.issueEnrolmentCode({
      patientId: first.patientId,
      displayName: first.displayName,
      requireClinicalProfile: true,
    });
    const firstDevice = identityStore.redeemEnrolmentCode(firstCode.code, {
      supportedMobileBuild: 7,
      supportsClinicManagedProfile: true,
    });
    assert.equal(firstDevice.status, 'ok');

    clock = new Date('2026-08-21T01:05:00.000Z');
    const second = identityStore.saveClinicalProfile({
      patientId: first.patientId,
      displayName: 'Last Visible Name',
      clinicalProfile: {
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Dizziness', 'Fatigue'],
        secondaryDisorder: null,
        secondarySymptoms: [],
      },
    });
    const secondCode = identityStore.issueEnrolmentCode({
      patientId: second.patientId,
      displayName: second.displayName,
      requireClinicalProfile: true,
    });
    assert.equal(second.clinicalProfile.revision, 2);

    clock = new Date('2026-08-21T02:00:00.000Z');
    const recoveredFirst = identityStore.recoverCollidedEnrolment({
      originalCode: firstCode.code,
      displayName: 'Correct Patient One',
    });
    assert.notEqual(recoveredFirst.patientId, first.patientId);
    assert.equal(recoveredFirst.originalCodeWasUsed, true);
    assert.equal(recoveredFirst.bridgedDevices, 1);
    assert.equal(recoveredFirst.revokedDevices, 0);
    assert.deepEqual(
      recoveredFirst.clinicalProfile.primarySymptoms,
      ['Headache', 'Nausea', 'Vomiting'],
    );
    assert.equal(recoveredFirst.clinicalProfile.revision, 1);
    const bridgedIdentity = identityStore.authenticate(firstDevice.accessToken);
    assert.equal(bridgedIdentity.patientId, first.patientId);
    assert.equal(bridgedIdentity.effectivePatientId, recoveredFirst.patientId);
    assert.equal(
      bridgedIdentity.patient.displayName,
      'Correct Patient One',
    );
    assert.equal(
      identityStore.redeemEnrolmentCode(secondCode.code, {
        supportedMobileBuild: 7,
        supportsClinicManagedProfile: true,
      }).status,
      'invalidated',
    );

    const replacementDevice = identityStore.redeemEnrolmentCode(
      recoveredFirst.code,
      {
        expectedPatientId: first.patientId,
        supportedMobileBuild: 7,
        supportsClinicManagedProfile: true,
      },
    );
    assert.equal(replacementDevice.status, 'ok');
    assert.equal(replacementDevice.patientId, recoveredFirst.patientId);
    assert.equal(replacementDevice.replacedPatientId, first.patientId);
    assert.equal(replacementDevice.replacedBridgeDevices, 1);
    assert.equal(identityStore.authenticate(firstDevice.accessToken), null);

    clock = new Date('2026-08-21T02:05:00.000Z');
    const recoveredSecond = identityStore.recoverCollidedEnrolment({
      originalCode: secondCode.code,
      displayName: 'Correct Patient Two',
    });
    assert.notEqual(recoveredSecond.patientId, recoveredFirst.patientId);
    assert.equal(recoveredSecond.originalCodeWasUsed, false);
    assert.deepEqual(
      recoveredSecond.clinicalProfile.primarySymptoms,
      ['Headache', 'Dizziness', 'Fatigue'],
    );
    assert.equal(recoveredSecond.clinicalProfile.revision, 2);
    const snapshot = identityStore.snapshot();
    assert.ok(snapshot.patients[first.patientId].quarantinedAt);
    assert.equal(
      snapshot.patients[first.patientId].identityCollision.recoveredCodeCount,
      2,
    );
    assert.throws(
      () => identityStore.issueEnrolmentCode({
        patientId: first.patientId,
        displayName: snapshot.patients[first.patientId].displayName,
      }),
      /quarantined/,
    );
    assert.throws(
      () => identityStore.recoverCollidedEnrolment({
        originalCode: firstCode.code,
        displayName: 'Duplicate Recovery',
      }),
      /already been recovered/,
    );
    assert.equal(
      fs.readdirSync(path.join(dataDir, 'backups'))
        .filter(name => name.startsWith('before-enrolment-recovery-')).length,
      2,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('independent profiles require an explicitly capable Build 8 device', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    const saved = identityStore.saveClinicalProfile({
      patientId: 'pt-independent-profile',
      displayName: 'Independent Profile',
      clinicalProfile: {
        schemaVersion: 3,
        disorderIds: ['migraine', 'dysautonomia'],
        symptomIds: ['headache', 'weakness', 'pain'],
      },
    });
    assert.equal(saved.clinicalProfile.schemaVersion, 3);
    assert.equal(saved.clinicalProfile.revision, 1);

    const issued = identityStore.issueEnrolmentCode({
      patientId: saved.patientId,
      displayName: saved.displayName,
      requireClinicalProfile: true,
    });
    const missingCapability = identityStore.redeemEnrolmentCode(issued.code, {
      supportedMobileBuild: 8,
      supportsClinicManagedProfile: true,
      supportsCanonicalDisorders: true,
      supportsIndependentProfiles: false,
    });
    assert.deepEqual(missingCapability, {
      status: 'upgrade_required',
      requiredBuild: 8,
    });

    const enrolled = identityStore.redeemEnrolmentCode(issued.code, {
      supportedMobileBuild: 8,
      supportsClinicManagedProfile: true,
      supportsCanonicalDisorders: true,
      supportsIndependentProfiles: true,
    });
    assert.equal(enrolled.status, 'ok');
    assert.equal(enrolled.clinicalProfile.schemaVersion, 3);
    assert.equal(
      identityStore.recordPayloadSchema(enrolled.accessToken, 3),
      true,
    );
    assert.equal(
      identityStore.compatibilitySummary().independentProfileDevices,
      1,
    );
    assert.equal(identityStore.compatibilitySummary().payloadSchemas[3], 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('independent profile edits create revisions without rewriting history', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    const first = identityStore.saveClinicalProfile({
      patientId: 'pt-independent-revision',
      displayName: 'Independent Revision',
      clinicalProfile: {
        schemaVersion: 3,
        disorderIds: ['migraine'],
        symptomIds: ['headache', 'nausea'],
      },
    });
    const second = identityStore.saveClinicalProfile({
      patientId: first.patientId,
      displayName: first.displayName,
      clinicalProfile: {
        schemaVersion: 3,
        disorderIds: ['migraine', 'dysautonomia'],
        symptomIds: ['headache', 'nausea', 'weakness'],
      },
    });
    assert.equal(second.clinicalProfile.revision, 2);
    const patient = identityStore.snapshot().patients[first.patientId];
    assert.equal(patient.clinicalProfileHistory.length, 2);
    assert.deepEqual(
      patient.clinicalProfileHistory[0].disorderIds,
      ['migraine'],
    );
    assert.deepEqual(
      patient.clinicalProfileHistory[0].symptomIds,
      ['headache', 'nausea'],
    );
    assert.deepEqual(
      patient.clinicalProfile.disorderIds,
      ['migraine', 'dysautonomia'],
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('independent profile renames preserve old labels across migration', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-identity-'));
  try {
    const disorderCatalog = createDisorderCatalogStore({ dataDir });
    const customSymptom = disorderCatalog.createCustomSymptom({
      displayName: 'Limb heaviness',
      confirmation: 'Limb heaviness',
    });
    const identityStore = createIdentityStore({
      dataDir,
      secret,
      disorderCatalog,
    });
    const saved = identityStore.saveClinicalProfile({
      patientId: 'pt-independent-rename',
      displayName: 'Independent Rename',
      clinicalProfile: {
        schemaVersion: 3,
        disorderIds: ['migraine'],
        // Schema 3 deliberately does not require adding the symptom to the
        // legacy Migraine availability map.
        symptomIds: ['headache', customSymptom.id],
      },
    });
    disorderCatalog.updateCustomSymptom({
      id: customSymptom.id,
      displayName: 'Heavy limb sensation',
      confirmation: 'Heavy limb sensation',
    });
    assert.equal(identityStore.refreshProfilesForSymptom(customSymptom.id), 1);
    assert.equal(identityStore.migrateCanonicalProfiles().migrated, false);

    const patient = identityStore.snapshot().patients[saved.patientId];
    assert.deepEqual(
      patient.clinicalProfile.symptoms,
      ['Headache', 'Heavy limb sensation'],
    );
    assert.deepEqual(
      patient.clinicalProfileHistory[0].symptoms,
      ['Headache', 'Limb heaviness'],
    );
    assert.equal(patient.clinicalProfileHistory[0].revision, 1);
    assert.equal(patient.clinicalProfile.revision, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
