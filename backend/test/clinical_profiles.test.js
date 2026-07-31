const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normaliseClinicalProfile,
  recordsMatchClinicalProfile,
  symptomCatalog,
} = require('../clinical_profiles');

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
