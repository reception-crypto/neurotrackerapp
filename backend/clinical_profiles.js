'use strict';

const symptomCatalog = Object.freeze({
  Migraine: Object.freeze([
    'Headache',
    'Nausea',
    'Vomiting',
    'Light sensitivity',
    'Sound sensitivity',
    'Visual aura',
    'Neck pain',
    'Dizziness',
    'Brain fog',
    'Fatigue',
  ]),
  Dysautonomia: Object.freeze([
    'Dizziness',
    'Light-headedness',
    'Palpitations',
    'Fatigue',
    'Brain fog',
    'Pain',
    'Weakness',
    'Exercise intolerance',
    'Nausea',
    'Temperature intolerance',
  ]),
  CIDP: Object.freeze([
    'Weakness',
    'Numbness',
    'Tingling',
    'Pain',
    'Fatigue',
    'Balance problems',
    'Walking difficulty',
    'Hand clumsiness',
    'Falls',
    'Muscle cramps',
  ]),
  'Myasthenia Gravis': Object.freeze([
    'Muscle weakness',
    'Double vision',
    'Drooping eyelids',
    'Difficulty swallowing',
    'Slurred speech',
    'Shortness of breath',
    'Chewing fatigue',
    'Neck weakness',
    'Arm weakness',
    'Leg weakness',
  ]),
});

const reviewClinicalProfile = Object.freeze({
  primaryDisorder: 'Migraine',
  primarySymptoms: Object.freeze(['Headache', 'Nausea', 'Vomiting']),
  secondaryDisorder: null,
  secondarySymptoms: Object.freeze([]),
});

function values(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function normaliseSymptoms(value) {
  return values(value).map(item => String(item || '').trim()).filter(Boolean);
}

function validateTrack(disorder, symptoms, label) {
  const available = symptomCatalog[disorder];
  if (!available) {
    throw new Error(`${label} disorder is not supported.`);
  }
  if (symptoms.length !== 3 || new Set(symptoms).size !== 3) {
    throw new Error(`${label} disorder must have exactly three unique symptoms.`);
  }
  if (symptoms.some(symptom => !available.includes(symptom))) {
    throw new Error(`${label} symptoms do not match the selected disorder.`);
  }
}

function normaliseClinicalProfile(input = {}) {
  const primaryDisorder = String(input.primaryDisorder || '').trim();
  const primarySymptoms = normaliseSymptoms(input.primarySymptoms);
  const secondaryDisorderText = String(input.secondaryDisorder || '').trim();
  const secondaryDisorder = secondaryDisorderText || null;
  const secondarySymptoms = normaliseSymptoms(input.secondarySymptoms);

  validateTrack(primaryDisorder, primarySymptoms, 'Primary');

  if (secondaryDisorder) {
    if (secondaryDisorder === primaryDisorder) {
      throw new Error('The second disorder must differ from the primary disorder.');
    }
    validateTrack(secondaryDisorder, secondarySymptoms, 'Second');
  } else if (secondarySymptoms.length) {
    throw new Error('Second symptoms require a second disorder.');
  }

  return {
    primaryDisorder,
    primarySymptoms,
    secondaryDisorder,
    secondarySymptoms: secondaryDisorder ? secondarySymptoms : [],
  };
}

function comparableProfile(profile = {}) {
  return {
    primaryDisorder: profile.primaryDisorder || '',
    primarySymptoms: [...(profile.primarySymptoms || [])],
    secondaryDisorder: profile.secondaryDisorder || null,
    secondarySymptoms: [...(profile.secondarySymptoms || [])],
  };
}

function sameClinicalProfile(left, right) {
  return JSON.stringify(comparableProfile(left)) ===
    JSON.stringify(comparableProfile(right));
}

function expectedRecordKeys(profile) {
  const keys = profile.primarySymptoms.map(
    symptom => `Primary|${profile.primaryDisorder}|${symptom}`,
  );
  if (profile.secondaryDisorder) {
    keys.push(...profile.secondarySymptoms.map(
      symptom => `Second|${profile.secondaryDisorder}|${symptom}`,
    ));
  }
  return keys.sort();
}

function recordsMatchClinicalProfile(profile, records) {
  if (!profile || !Array.isArray(records)) return false;
  const submitted = records.map(
    record => `${record.track}|${record.disorder}|${record.symptom}`,
  ).sort();
  return JSON.stringify(submitted) ===
    JSON.stringify(expectedRecordKeys(profile));
}

module.exports = {
  normaliseClinicalProfile,
  recordsMatchClinicalProfile,
  reviewClinicalProfile,
  sameClinicalProfile,
  symptomCatalog,
  values,
};
