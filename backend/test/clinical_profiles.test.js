const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canonicalRecordsForClinicalProfile,
  normaliseClinicalProfile,
  profileMinimumBuild,
  recordsMatchClinicalProfile,
  sameClinicalProfile,
  symptomCatalog,
} = require('../clinical_profiles');
const { createDisorderCatalogStore } = require('../disorder_catalog');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Dysautonomia catalogue uses the approved Build 7 symptoms', () => {
  assert.ok(symptomCatalog.Dysautonomia.includes('Pain'));
  assert.ok(symptomCatalog.Dysautonomia.includes('Weakness'));
  assert.equal(
    symptomCatalog.Dysautonomia.includes('Shortness of breath'),
    false,
  );
  assert.equal(
    symptomCatalog.Dysautonomia.includes('Sweating changes'),
    false,
  );
});

test('clinic profiles require exactly three supported symptoms per disorder', () => {
  assert.throws(
    () => normaliseClinicalProfile({
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea'],
    }),
    /exactly three/,
  );
  assert.throws(
    () => normaliseClinicalProfile({
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Not in catalogue'],
    }),
    /do not match/,
  );
  assert.throws(
    () => normaliseClinicalProfile({
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
      secondaryDisorder: 'Migraine',
      secondarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
    }),
    /must differ/,
  );
});

test('submitted records must exactly match the versioned clinic profile', () => {
  const profile = normaliseClinicalProfile({
    primaryDisorder: 'Dysautonomia',
    primarySymptoms: ['Dizziness', 'Pain', 'Weakness'],
  });
  const matching = [
    {
      track: 'Primary',
      disorder: 'Dysautonomia',
      symptom: 'Weakness',
    },
    {
      track: 'Primary',
      disorder: 'Dysautonomia',
      symptom: 'Dizziness',
    },
    {
      track: 'Primary',
      disorder: 'Dysautonomia',
      symptom: 'Pain',
    },
  ];
  assert.equal(recordsMatchClinicalProfile(profile, matching), true);
  assert.equal(
    recordsMatchClinicalProfile(profile, [
      ...matching.slice(0, 2),
      {
        track: 'Primary',
        disorder: 'Dysautonomia',
        symptom: 'Fatigue',
      },
    ]),
    false,
  );
});

test('legacy built-in profiles gain IDs without creating a false change', () => {
  const legacy = {
    primaryDisorder: 'Migraine',
    primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
    secondaryDisorder: null,
    secondarySymptoms: [],
  };
  const canonical = normaliseClinicalProfile(legacy);
  assert.equal(canonical.primaryDisorderId, 'migraine');
  assert.deepEqual(
    canonical.primarySymptomIds,
    ['headache', 'nausea', 'vomiting'],
  );
  assert.equal(canonical.minimumAppBuild, 7);
  assert.equal(sameClinicalProfile(legacy, canonical), true);
});

test('custom profiles use registered IDs and require Build 8', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-profile-'));
  try {
    const catalog = createDisorderCatalogStore({ dataDir });
    const disorder = catalog.createCustomDisorder({
      displayName: 'Multiple sclerosis',
      confirmation: 'Multiple sclerosis',
    });
    const profile = normaliseClinicalProfile({
      primaryDisorderId: disorder.id,
      primarySymptomIds: ['pain', 'dizziness', 'fatigue'],
    }, { disorderCatalog: catalog });
    assert.equal(profile.primaryDisorderId, disorder.id);
    assert.equal(profile.primaryDisorder, 'Multiple sclerosis');
    assert.deepEqual(profile.primarySymptoms, ['Pain', 'Dizziness', 'Fatigue']);
    assert.equal(profileMinimumBuild(profile), 8);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('accepted records are stamped from the assigned canonical profile', () => {
  const profile = normaliseClinicalProfile({
    primaryDisorder: 'Dysautonomia',
    primarySymptoms: ['Dizziness', 'Pain', 'Weakness'],
  });
  const records = [
    { track: 'Primary', disorder: 'Dysautonomia', symptom: 'Pain', score: 4 },
    { track: 'Primary', disorder: 'Dysautonomia', symptom: 'Weakness', score: 3 },
    { track: 'Primary', disorder: 'Dysautonomia', symptom: 'Dizziness', score: 2 },
  ];
  const canonical = canonicalRecordsForClinicalProfile(profile, records);
  assert.deepEqual(
    canonical.map(record => [record.disorderId, record.symptomId]),
    [
      ['dysautonomia', 'pain'],
      ['dysautonomia', 'weakness'],
      ['dysautonomia', 'dizziness'],
    ],
  );
  assert.equal(
    recordsMatchClinicalProfile(profile, [
      { ...records[0], disorderId: 'migraine' },
      records[1],
      records[2],
    ]),
    false,
  );
});

test('retired symptoms migrate historically but cannot be newly assigned', () => {
  const legacy = {
    primaryDisorder: 'Dysautonomia',
    primarySymptoms: ['Dizziness', 'Sweating changes', 'Fatigue'],
  };
  assert.throws(
    () => normaliseClinicalProfile(legacy),
    /do not match/,
  );
  const historical = normaliseClinicalProfile(legacy, {
    allowHistoricalSymptoms: true,
  });
  assert.deepEqual(
    historical.primarySymptomIds,
    ['dizziness', 'sweating-changes', 'fatigue'],
  );
});
