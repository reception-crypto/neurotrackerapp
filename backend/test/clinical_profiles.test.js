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

test('Migraine catalogue adds Vertigo while preserving Dizziness', () => {
  assert.ok(symptomCatalog.Migraine.includes('Vertigo'));
  assert.ok(symptomCatalog.Migraine.includes('Dizziness'));
  assert.equal(symptomCatalog.Migraine.includes('Visual aura'), false);

  const historical = normaliseClinicalProfile({
    primaryDisorder: 'Migraine',
    primarySymptoms: ['Headache', 'Visual aura', 'Dizziness'],
  }, {
    allowHistoricalSymptoms: true,
  });
  assert.deepEqual(
    historical.primarySymptomIds,
    ['headache', 'visual-aura', 'dizziness'],
  );
  assert.equal(recordsMatchClinicalProfile(historical, [
    { track: 'Primary', disorder: 'Migraine', symptom: 'Dizziness' },
    { track: 'Primary', disorder: 'Migraine', symptom: 'Visual aura' },
    { track: 'Primary', disorder: 'Migraine', symptom: 'Headache' },
  ]), true);
  assert.throws(
    () => normaliseClinicalProfile({
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Visual aura', 'Dizziness'],
    }),
    /do not match/,
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

test('a custom symptom makes only profiles that select it require Build 8', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-profile-'));
  try {
    const catalog = createDisorderCatalogStore({ dataDir });
    const customSymptom = catalog.createCustomSymptom({
      displayName: 'Limb heaviness',
      confirmation: 'Limb heaviness',
    });
    const migraine = catalog.findDisorder({ id: 'migraine' });
    catalog.setDisorderSymptoms({
      disorderId: migraine.id,
      symptomIds: [...migraine.allowedSymptomIds, customSymptom.id],
    });

    const legacyCompatible = normaliseClinicalProfile({
      primaryDisorderId: 'migraine',
      primarySymptomIds: ['headache', 'nausea', 'dizziness'],
    }, { disorderCatalog: catalog });
    assert.equal(profileMinimumBuild(legacyCompatible), 7);

    const build8Profile = normaliseClinicalProfile({
      primaryDisorderId: 'migraine',
      primarySymptomIds: ['headache', 'nausea', customSymptom.id],
    }, { disorderCatalog: catalog });
    assert.equal(profileMinimumBuild(build8Profile), 8);
    assert.equal(build8Profile.primarySymptoms[2], 'Limb heaviness');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('removing a symptom from future choices does not invalidate an old profile revision', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-profile-'));
  try {
    const catalog = createDisorderCatalogStore({ dataDir });
    const original = normaliseClinicalProfile({
      primaryDisorderId: 'migraine',
      primarySymptomIds: ['headache', 'nausea', 'dizziness'],
    }, { disorderCatalog: catalog });
    const migraine = catalog.findDisorder({ id: 'migraine' });
    catalog.setDisorderSymptoms({
      disorderId: 'migraine',
      symptomIds: migraine.allowedSymptomIds.filter(id => id !== 'headache'),
    });

    assert.throws(
      () => normaliseClinicalProfile({
        primaryDisorderId: 'migraine',
        primarySymptomIds: ['headache', 'nausea', 'dizziness'],
      }, { disorderCatalog: catalog }),
      /do not match/,
    );
    const historical = normaliseClinicalProfile({
      primaryDisorderId: original.primaryDisorderId,
      primarySymptomIds: original.primarySymptomIds,
    }, {
      disorderCatalog: catalog,
      allowHistoricalSymptoms: true,
    });
    assert.deepEqual(historical.primarySymptomIds, original.primarySymptomIds);
    assert.deepEqual(historical.primarySymptoms, original.primarySymptoms);
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

test('independent profiles select global symptoms without disorder nesting', () => {
  const profile = normaliseClinicalProfile({
    schemaVersion: 3,
    disorderIds: ['migraine'],
    // Weakness was not part of the Build 7 Migraine symptom mapping.
    symptomIds: ['headache', 'weakness', 'pain'],
  });

  assert.equal(profile.schemaVersion, 3);
  assert.deepEqual(profile.disorders, ['Migraine']);
  assert.deepEqual(profile.symptoms, ['Headache', 'Weakness', 'Pain']);
  assert.equal(profileMinimumBuild(profile), 8);

  const canonical = canonicalRecordsForClinicalProfile(profile, [
    { track: 'Independent', symptomId: 'weakness', score: 3 },
    { track: 'Independent', symptomId: 'pain', score: 4 },
    { track: 'Independent', symptomId: 'headache', score: 2 },
  ]);
  assert.deepEqual(
    canonical.map(record => [
      record.track,
      record.disorderId,
      record.symptomId,
    ]),
    [
      ['Independent', '', 'weakness'],
      ['Independent', '', 'pain'],
      ['Independent', '', 'headache'],
    ],
  );
});

test('independent profiles allow one to six unique symptoms only', () => {
  const disorderIds = ['migraine', 'dysautonomia'];
  const six = [
    'headache',
    'nausea',
    'vertigo',
    'dizziness',
    'pain',
    'weakness',
  ];
  assert.equal(normaliseClinicalProfile({
    schemaVersion: 3,
    disorderIds,
    symptomIds: ['vertigo'],
  }).symptomIds.length, 1);
  assert.equal(normaliseClinicalProfile({
    schemaVersion: 3,
    disorderIds,
    symptomIds: six,
  }).symptomIds.length, 6);
  assert.throws(
    () => normaliseClinicalProfile({
      schemaVersion: 3,
      disorderIds,
      symptomIds: [],
    }),
    /between 1 and 6/,
  );
  assert.throws(
    () => normaliseClinicalProfile({
      schemaVersion: 3,
      disorderIds,
      symptomIds: [...six, 'fatigue'],
    }),
    /between 1 and 6/,
  );
  assert.throws(
    () => normaliseClinicalProfile({
      schemaVersion: 3,
      disorderIds,
      symptomIds: ['pain', 'pain'],
    }),
    /unique/,
  );
});

test('independent records rate each symptom once and carry no disorder', () => {
  const profile = normaliseClinicalProfile({
    schemaVersion: 3,
    disorderIds: ['migraine', 'dysautonomia'],
    symptomIds: ['dizziness', 'pain'],
  });
  assert.equal(recordsMatchClinicalProfile(profile, [
    { track: 'Independent', symptomId: 'dizziness' },
    { track: 'Independent', symptomId: 'pain' },
  ]), true);
  assert.equal(recordsMatchClinicalProfile(profile, [
    { track: 'Independent', symptomId: 'dizziness' },
    { track: 'Independent', symptomId: 'dizziness' },
  ]), false);
  assert.equal(recordsMatchClinicalProfile(profile, [
    {
      track: 'Independent',
      disorderId: 'migraine',
      symptomId: 'dizziness',
    },
    { track: 'Independent', symptomId: 'pain' },
  ]), false);
});
