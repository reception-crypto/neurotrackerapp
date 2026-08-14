'use strict';

const {
  builtInSymptomCatalog,
  staticDisorderCatalog,
} = require('./disorder_catalog');

const symptomCatalog = builtInSymptomCatalog;
const independentProfileSchemaVersion = 3;
const minimumIndependentSymptoms = 1;
const maximumIndependentSymptoms = 6;

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

function normaliseStrings(value) {
  return values(value)
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function normaliseTrack({
  disorderId = '',
  disorder = '',
  symptomIds = [],
  symptoms = [],
  label,
  disorderCatalog,
  includeInactive,
  allowHistoricalSymptoms,
}) {
  const definition = disorderCatalog.findDisorder({
    id: disorderId,
    displayName: disorder,
    includeInactive,
  });
  if (!definition) {
    throw new Error(`${label} disorder is not supported.`);
  }

  const submittedIds = normaliseStrings(symptomIds);
  const submittedLabels = normaliseStrings(symptoms);
  const selected = [];
  if (submittedIds.length) {
    if (submittedIds.length !== 3 || new Set(submittedIds).size !== 3) {
      throw new Error(
        `${label} disorder must have exactly three unique symptoms.`,
      );
    }
    if (submittedLabels.length && submittedLabels.length !== submittedIds.length) {
      throw new Error(`${label} symptom identifiers and names do not match.`);
    }
    for (let index = 0; index < submittedIds.length; index++) {
      const symptom = disorderCatalog.findSymptom(definition, {
        id: submittedIds[index],
        displayName: submittedLabels[index] || '',
      }) || (allowHistoricalSymptoms
        ? disorderCatalog.findGlobalSymptom({
            id: submittedIds[index],
            displayName: submittedLabels[index] || '',
          })
        : null);
      if (!symptom) {
        throw new Error(
          `${label} symptoms do not match the selected disorder.`,
        );
      }
      selected.push(symptom);
    }
  } else {
    if (
      submittedLabels.length !== 3 ||
      new Set(submittedLabels).size !== 3
    ) {
      throw new Error(
        `${label} disorder must have exactly three unique symptoms.`,
      );
    }
    for (const displayName of submittedLabels) {
      const symptom = disorderCatalog.findSymptom(definition, { displayName });
      const resolvedSymptom = symptom || (allowHistoricalSymptoms
        ? disorderCatalog.findGlobalSymptom({ displayName })
        : null);
      if (!resolvedSymptom) {
        throw new Error(
          `${label} symptoms do not match the selected disorder.`,
        );
      }
      selected.push(resolvedSymptom);
    }
  }

  if (new Set(selected.map(item => item.id)).size !== 3) {
    throw new Error(`${label} disorder must have exactly three unique symptoms.`);
  }
  return {
    disorderId: definition.id,
    disorder: definition.displayName,
    symptomIds: selected.map(item => item.id),
    symptoms: selected.map(item => item.displayName),
    minimumAppBuild: Math.max(
      Number(definition.minimumAppBuild || 7),
      ...selected.map(item => Number(item.minimumAppBuild || 7)),
    ),
  };
}

function isIndependentClinicalProfile(profile = {}) {
  return Boolean(profile) &&
    Number(profile.schemaVersion) === independentProfileSchemaVersion;
}

function normaliseIndependentClinicalProfile(
  input = {},
  {
    disorderCatalog = staticDisorderCatalog,
    includeInactive = false,
    allowHistoricalSymptoms = false,
  } = {},
) {
  const submittedDisorderIds = normaliseStrings(input.disorderIds);
  const submittedDisorderNames = normaliseStrings(input.disorders);
  if (!submittedDisorderIds.length && !submittedDisorderNames.length) {
    throw new Error('Select at least one disorder.');
  }
  if (
    submittedDisorderIds.length &&
    submittedDisorderNames.length &&
    submittedDisorderIds.length !== submittedDisorderNames.length
  ) {
    throw new Error('Disorder identifiers and names do not match.');
  }

  const disorderCount = submittedDisorderIds.length ||
    submittedDisorderNames.length;
  const selectedDisorders = [];
  for (let index = 0; index < disorderCount; index++) {
    const disorder = disorderCatalog.findDisorder({
      id: submittedDisorderIds[index] || '',
      displayName: submittedDisorderNames[index] || '',
      includeInactive,
    });
    if (!disorder || (!includeInactive && disorder.active === false)) {
      throw new Error('A selected disorder is not available.');
    }
    selectedDisorders.push(disorder);
  }
  if (
    new Set(selectedDisorders.map(item => item.id)).size !==
    selectedDisorders.length
  ) {
    throw new Error('Each selected disorder must be unique.');
  }

  const submittedSymptomIds = normaliseStrings(input.symptomIds);
  const submittedSymptomNames = normaliseStrings(input.symptoms);
  const symptomCount = submittedSymptomIds.length || submittedSymptomNames.length;
  if (
    symptomCount < minimumIndependentSymptoms ||
    symptomCount > maximumIndependentSymptoms
  ) {
    throw new Error(
      `Select between ${minimumIndependentSymptoms} and ` +
      `${maximumIndependentSymptoms} symptoms.`,
    );
  }
  if (
    submittedSymptomIds.length &&
    submittedSymptomNames.length &&
    submittedSymptomIds.length !== submittedSymptomNames.length
  ) {
    throw new Error('Symptom identifiers and names do not match.');
  }

  const selectedSymptoms = [];
  for (let index = 0; index < symptomCount; index++) {
    const symptom = disorderCatalog.findGlobalSymptom({
      id: submittedSymptomIds[index] || '',
      displayName: submittedSymptomNames[index] || '',
    });
    const available = symptom && (
      symptom.active !== false && symptom.kind !== 'historical' ||
      allowHistoricalSymptoms || includeInactive
    );
    if (!available) {
      throw new Error('A selected symptom is not available.');
    }
    selectedSymptoms.push(symptom);
  }
  if (
    new Set(selectedSymptoms.map(item => item.id)).size !==
    selectedSymptoms.length
  ) {
    throw new Error('Each selected symptom must be unique.');
  }

  return {
    schemaVersion: independentProfileSchemaVersion,
    disorderIds: selectedDisorders.map(item => item.id),
    disorders: selectedDisorders.map(item => item.displayName),
    symptomIds: selectedSymptoms.map(item => item.id),
    symptoms: selectedSymptoms.map(item => item.displayName),
    minimumAppBuild: Math.max(
      8,
      ...selectedDisorders.map(item => Number(item.minimumAppBuild || 7)),
      ...selectedSymptoms.map(item => Number(item.minimumAppBuild || 7)),
    ),
  };
}

function normaliseClinicalProfile(
  input = {},
  {
    disorderCatalog = staticDisorderCatalog,
    includeInactive = false,
    allowHistoricalSymptoms = false,
  } = {},
) {
  if (
    Number(input.schemaVersion) === independentProfileSchemaVersion ||
    Array.isArray(input.disorderIds) ||
    Array.isArray(input.symptomIds)
  ) {
    return normaliseIndependentClinicalProfile(input, {
      disorderCatalog,
      includeInactive,
      allowHistoricalSymptoms,
    });
  }

  const primary = normaliseTrack({
    disorderId: input.primaryDisorderId,
    disorder: input.primaryDisorder,
    symptomIds: input.primarySymptomIds,
    symptoms: input.primarySymptoms,
    label: 'Primary',
    disorderCatalog,
    includeInactive,
    allowHistoricalSymptoms,
  });

  const secondaryId = String(input.secondaryDisorderId || '').trim();
  const secondaryName = String(input.secondaryDisorder || '').trim();
  const secondarySymptomIds = normaliseStrings(input.secondarySymptomIds);
  const secondarySymptoms = normaliseStrings(input.secondarySymptoms);
  const hasSecondary = Boolean(secondaryId || secondaryName);
  let secondary = null;
  if (hasSecondary) {
    secondary = normaliseTrack({
      disorderId: secondaryId,
      disorder: secondaryName,
      symptomIds: secondarySymptomIds,
      symptoms: secondarySymptoms,
      label: 'Second',
      disorderCatalog,
      includeInactive,
      allowHistoricalSymptoms,
    });
    if (secondary.disorderId === primary.disorderId) {
      throw new Error('The second disorder must differ from the primary disorder.');
    }
  } else if (secondarySymptomIds.length || secondarySymptoms.length) {
    throw new Error('Second symptoms require a second disorder.');
  }

  return {
    schemaVersion: 2,
    primaryDisorderId: primary.disorderId,
    primaryDisorder: primary.disorder,
    primarySymptomIds: primary.symptomIds,
    primarySymptoms: primary.symptoms,
    secondaryDisorderId: secondary?.disorderId || null,
    secondaryDisorder: secondary?.disorder || null,
    secondarySymptomIds: secondary?.symptomIds || [],
    secondarySymptoms: secondary?.symptoms || [],
    minimumAppBuild: Math.max(
      primary.minimumAppBuild,
      secondary?.minimumAppBuild || 7,
    ),
  };
}

function canonicalDisorderId(id, displayName) {
  if (id) return String(id);
  return staticDisorderCatalog.findDisorder({ displayName })?.id ||
    `legacy:${String(displayName || '')}`;
}

function canonicalSymptomIds(disorderId, disorderName, ids, labels) {
  if (Array.isArray(ids) && ids.length) return [...ids];
  const disorder = staticDisorderCatalog.findDisorder({
    id: disorderId,
    displayName: disorderId ? '' : disorderName,
  });
  return [...(labels || [])].map(displayName =>
    staticDisorderCatalog.findSymptom(disorder, { displayName })?.id ||
      `legacy:${displayName}`
  );
}

function comparableProfile(profile = {}) {
  if (isIndependentClinicalProfile(profile)) {
    return {
      schemaVersion: independentProfileSchemaVersion,
      disorderIds: [...(profile.disorderIds || [])],
      disorders: [...(profile.disorders || [])],
      symptomIds: [...(profile.symptomIds || [])],
      symptoms: [...(profile.symptoms || [])],
    };
  }
  const primaryDisorderId = canonicalDisorderId(
    profile.primaryDisorderId,
    profile.primaryDisorder,
  );
  const secondaryDisorderId = profile.secondaryDisorderId ||
    profile.secondaryDisorder
    ? canonicalDisorderId(
        profile.secondaryDisorderId,
        profile.secondaryDisorder,
      )
    : null;
  return {
    primaryDisorderId,
    primaryDisorder: String(profile.primaryDisorder || ''),
    primarySymptomIds: canonicalSymptomIds(
      primaryDisorderId,
      profile.primaryDisorder,
      profile.primarySymptomIds,
      profile.primarySymptoms,
    ),
    primarySymptoms: [...(profile.primarySymptoms || [])],
    secondaryDisorderId,
    secondaryDisorder: secondaryDisorderId
      ? String(profile.secondaryDisorder || '')
      : null,
    secondarySymptomIds: secondaryDisorderId
      ? canonicalSymptomIds(
          secondaryDisorderId,
          profile.secondaryDisorder,
          profile.secondarySymptomIds,
          profile.secondarySymptoms,
        )
      : [],
    secondarySymptoms: secondaryDisorderId
      ? [...(profile.secondarySymptoms || [])]
      : [],
  };
}

function sameClinicalProfile(left, right) {
  return JSON.stringify(comparableProfile(left)) ===
    JSON.stringify(comparableProfile(right));
}

function expectedProfileRecords(profile = {}) {
  if (isIndependentClinicalProfile(profile)) {
    return (profile.symptoms || []).map((symptom, index) => ({
      track: 'Independent',
      disorderId: '',
      disorder: '',
      symptomId: profile.symptomIds[index],
      symptom,
    }));
  }
  const comparable = comparableProfile(profile);
  const records = (profile.primarySymptoms || []).map((symptom, index) => ({
    track: 'Primary',
    disorderId: comparable.primaryDisorderId,
    disorder: profile.primaryDisorder,
    symptomId: comparable.primarySymptomIds[index],
    symptom,
  }));
  if (comparable.secondaryDisorderId) {
    records.push(...(profile.secondarySymptoms || []).map((symptom, index) => ({
      track: 'Second',
      disorderId: comparable.secondaryDisorderId,
      disorder: profile.secondaryDisorder,
      symptomId: comparable.secondarySymptomIds[index],
      symptom,
    })));
  }
  return records;
}

function recordMatchesExpected(record, expected) {
  if (String(record?.track || '') !== expected.track) return false;
  const suppliedDisorderId = String(record?.disorderId || '').trim();
  const suppliedDisorder = String(record?.disorder || '').trim();
  const suppliedSymptomId = String(record?.symptomId || '').trim();
  const suppliedSymptom = String(record?.symptom || '').trim();
  if (expected.track === 'Independent') {
    if (suppliedDisorderId || suppliedDisorder) return false;
    if (suppliedSymptomId && suppliedSymptomId !== expected.symptomId) {
      return false;
    }
    if (suppliedSymptom && suppliedSymptom !== expected.symptom) return false;
    return Boolean(suppliedSymptomId || suppliedSymptom);
  }
  if (suppliedDisorderId && suppliedDisorderId !== expected.disorderId) {
    return false;
  }
  if (suppliedDisorder && suppliedDisorder !== expected.disorder) return false;
  if (suppliedSymptomId && suppliedSymptomId !== expected.symptomId) {
    return false;
  }
  if (suppliedSymptom && suppliedSymptom !== expected.symptom) return false;
  return Boolean(
    (suppliedDisorderId || suppliedDisorder) &&
    (suppliedSymptomId || suppliedSymptom),
  );
}

function canonicalRecordsForClinicalProfile(profile, records) {
  if (!profile || !Array.isArray(records)) return null;
  const expectedRecords = expectedProfileRecords(profile);
  if (expectedRecords.length !== records.length) return null;
  const unused = [...expectedRecords];
  const canonical = [];
  for (const record of records) {
    const index = unused.findIndex(expected =>
      recordMatchesExpected(record, expected)
    );
    if (index < 0) return null;
    const [expected] = unused.splice(index, 1);
    canonical.push({
      ...record,
      track: expected.track,
      disorderId: expected.disorderId,
      disorder: expected.disorder,
      symptomId: expected.symptomId,
      symptom: expected.symptom,
    });
  }
  return canonical;
}

function recordsMatchClinicalProfile(profile, records) {
  return canonicalRecordsForClinicalProfile(profile, records) != null;
}

function profileMinimumBuild(profile = {}) {
  return Math.max(7, Number(profile.minimumAppBuild || 7));
}

module.exports = {
  canonicalRecordsForClinicalProfile,
  independentProfileSchemaVersion,
  isIndependentClinicalProfile,
  maximumIndependentSymptoms,
  minimumIndependentSymptoms,
  normaliseClinicalProfile,
  normaliseIndependentClinicalProfile,
  profileMinimumBuild,
  recordsMatchClinicalProfile,
  reviewClinicalProfile,
  sameClinicalProfile,
  symptomCatalog,
  values,
};
