'use strict';

const fs = require('node:fs');
const path = require('node:path');

const requiredCsvColumns = [
  'ReceivedAt',
  'Date',
  'Time',
  'Patient',
  'Track',
  'Disorder',
  'Symptom',
  'Score',
  'WellnessPercent',
  'SubmissionId',
  'PatientId',
  'ProfileRevision',
  'DisorderId',
  'SymptomId',
  'PayloadSchemaVersion',
  'ProfileDisorderIds',
  'ProfileDisorders',
];

const legacyCustomSymptomIdPattern =
  /^custom-symptom-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index++;
      row.push(cell);
      cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('The symptom CSV contains an unterminated quote.');
  if (cell || row.length) {
    row.push(cell);
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function canonicalProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (Number(profile.schemaVersion) === 3) {
    return Array.isArray(profile.disorderIds) &&
      profile.disorderIds.length >= 1 &&
      new Set(profile.disorderIds).size === profile.disorderIds.length &&
      profile.disorderIds.every(id =>
        String(id || '').trim() && !String(id).startsWith('legacy:')) &&
      Array.isArray(profile.disorders) &&
      profile.disorders.length === profile.disorderIds.length &&
      profile.disorders.every(name => String(name || '').trim()) &&
      Array.isArray(profile.symptomIds) &&
      profile.symptomIds.length >= 1 &&
      profile.symptomIds.length <= 6 &&
      new Set(profile.symptomIds).size === profile.symptomIds.length &&
      profile.symptomIds.every(id =>
        String(id || '').trim() && !String(id).startsWith('legacy:')) &&
      Array.isArray(profile.symptoms) &&
      profile.symptoms.length === profile.symptomIds.length &&
      profile.symptoms.every(name => String(name || '').trim()) &&
      Number(profile.minimumAppBuild) >= 8;
  }
  if (Number(profile.schemaVersion) < 2) return false;
  if (!String(profile.primaryDisorderId || '').trim()) return false;
  if (String(profile.primaryDisorderId).startsWith('legacy:')) return false;
  if (!Array.isArray(profile.primarySymptomIds) ||
      profile.primarySymptomIds.length !== 3 ||
      profile.primarySymptomIds.some(id =>
        !String(id || '').trim() || String(id).startsWith('legacy:'))) {
    return false;
  }

  const hasSecondary = Boolean(
    String(profile.secondaryDisorderId || '').trim() ||
    String(profile.secondaryDisorder || '').trim(),
  );
  if (!hasSecondary) {
    return !profile.secondaryDisorderId &&
      Array.isArray(profile.secondarySymptomIds) &&
      profile.secondarySymptomIds.length === 0;
  }
  return Boolean(String(profile.secondaryDisorderId || '').trim()) &&
    !String(profile.secondaryDisorderId).startsWith('legacy:') &&
    Array.isArray(profile.secondarySymptomIds) &&
    profile.secondarySymptomIds.length === 3 &&
    profile.secondarySymptomIds.every(id =>
      String(id || '').trim() && !String(id).startsWith('legacy:'));
}

function snapshotData(dataDirectory) {
  const resolvedDataDirectory = path.resolve(dataDirectory);
  const identity = readJson(
    path.join(resolvedDataDirectory, 'identity_store.json'),
    'The identity store',
  );
  const patients = identity.patients && typeof identity.patients === 'object'
    ? Object.values(identity.patients)
    : [];
  const enrolmentCodes = identity.enrolmentCodes &&
    typeof identity.enrolmentCodes === 'object'
    ? Object.values(identity.enrolmentCodes)
    : [];
  const devices = identity.devices && typeof identity.devices === 'object'
    ? Object.values(identity.devices)
    : [];

  const currentProfiles = patients
    .map(patient => patient && patient.clinicalProfile)
    .filter(Boolean);
  const historicalProfiles = patients.flatMap(patient =>
    Array.isArray(patient && patient.clinicalProfileHistory)
      ? patient.clinicalProfileHistory.filter(Boolean)
      : [],
  );

  const csvPath = path.join(resolvedDataDirectory, 'symptom_entries.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`The symptom CSV is missing: ${csvPath}`);
  }
  const csvRows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (!csvRows.length) throw new Error('The symptom CSV has no header row.');
  const csvColumns = csvRows[0];

  const catalogPath = path.join(
    resolvedDataDirectory,
    'disorder_catalog.json',
  );
  let catalog = null;
  if (fs.existsSync(catalogPath)) {
    catalog = readJson(catalogPath, 'The disorder catalogue');
  }
  const customSymptomIds = catalog && catalog.customSymptoms &&
    typeof catalog.customSymptoms === 'object'
    ? Object.keys(catalog.customSymptoms)
    : [];
  const symptomIdAliases = catalog && catalog.symptomIdAliases &&
    typeof catalog.symptomIdAliases === 'object'
    ? Object.keys(catalog.symptomIdAliases)
    : [];

  return {
    snapshotVersion: 1,
    identityStoreVersion: Number(identity.version || 0),
    patientCount: patients.length,
    enrolmentCodeCount: enrolmentCodes.length,
    deviceCount: devices.length,
    activeDeviceCount: devices.filter(device => !device.revokedAt).length,
    currentProfileCount: currentProfiles.length,
    canonicalCurrentProfileCount: currentProfiles.filter(canonicalProfile).length,
    historicalProfileCount: historicalProfiles.length,
    canonicalHistoricalProfileCount:
      historicalProfiles.filter(canonicalProfile).length,
    csvDataRowCount: Math.max(0, csvRows.length - 1),
    csvColumns,
    disorderCatalogPresent: Boolean(catalog),
    disorderCatalogVersion: catalog ? Number(catalog.version || 0) : null,
    customDisorderCount: catalog && catalog.customDisorders &&
      typeof catalog.customDisorders === 'object'
      ? Object.keys(catalog.customDisorders).length
      : 0,
    customSymptomCount: customSymptomIds.length,
    legacyCustomSymptomIdCount: customSymptomIds.filter(
      id => legacyCustomSymptomIdPattern.test(id),
    ).length,
    symptomIdAliasCount: symptomIdAliases.length,
    disorderAuditEventCount: catalog && Array.isArray(catalog.auditLog)
      ? catalog.auditLog.length
      : 0,
  };
}

function assertEqual(before, after, key, description) {
  if (before[key] !== after[key]) {
    throw new Error(
      `${description} changed from ${before[key]} to ${after[key]}.`,
    );
  }
}

function compareAfterMigration(before, after) {
  assertEqual(before, after, 'patientCount', 'Patient count');
  assertEqual(before, after, 'enrolmentCodeCount', 'Enrolment-code count');
  assertEqual(before, after, 'deviceCount', 'Device count');
  assertEqual(before, after, 'activeDeviceCount', 'Active-device count');
  assertEqual(before, after, 'currentProfileCount', 'Current-profile count');
  assertEqual(before, after, 'csvDataRowCount', 'Symptom CSV row count');
  assertEqual(before, after, 'customDisorderCount', 'Custom-disorder count');
  assertEqual(before, after, 'customSymptomCount', 'Custom-symptom count');
  const migratedSymptomIds = Number(before.disorderCatalogVersion || 0) < 3
    ? Number(before.legacyCustomSymptomIdCount || 0)
    : 0;
  const expectedAuditEvents = Number(before.disorderAuditEventCount || 0) +
    migratedSymptomIds;
  if (Number(after.disorderAuditEventCount || 0) !== expectedAuditEvents) {
    throw new Error(
      'Disorder-catalogue audit-event count changed unexpectedly from ' +
      `${before.disorderAuditEventCount || 0} to ` +
      `${after.disorderAuditEventCount || 0}.`,
    );
  }
  const expectedAliases = Number(before.symptomIdAliasCount || 0) +
    migratedSymptomIds;
  if (Number(after.symptomIdAliasCount || 0) !== expectedAliases) {
    throw new Error(
      'Custom-symptom identifier alias count did not match the guarded ' +
      'catalogue migration.',
    );
  }

  if (after.historicalProfileCount < before.historicalProfileCount) {
    throw new Error(
      'Profile-history count fell from ' + before.historicalProfileCount +
      ' to ' + after.historicalProfileCount + '.',
    );
  }

  if (after.identityStoreVersion < 3) {
    throw new Error('The migrated identity-store version is below 3.');
  }
  if (after.canonicalCurrentProfileCount !== after.currentProfileCount) {
    throw new Error('At least one current profile lacks canonical identifiers.');
  }
  if (after.canonicalHistoricalProfileCount !== after.historicalProfileCount) {
    throw new Error('At least one historical profile lacks canonical identifiers.');
  }
  if (!after.disorderCatalogPresent || after.disorderCatalogVersion !== 3) {
    throw new Error('The Build 8 disorder catalogue was not initialised safely.');
  }
  if (Number(after.legacyCustomSymptomIdCount || 0) !== 0) {
    throw new Error('A UUID-style custom symptom identifier remains after migration.');
  }
  const missingColumns = requiredCsvColumns.filter(
    column => !after.csvColumns.includes(column),
  );
  if (missingColumns.length) {
    throw new Error(
      `The migrated symptom CSV is missing: ${missingColumns.join(', ')}.`,
    );
  }
}

function writeSnapshot(filePath, snapshot) {
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function run(arguments_) {
  const [command, firstPath, secondPath, thirdPath] = arguments_;
  if (command === 'snapshot' && firstPath && secondPath && !thirdPath) {
    const snapshot = snapshotData(firstPath);
    writeSnapshot(secondPath, snapshot);
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return;
  }
  if (command === 'compare' && firstPath && secondPath && thirdPath) {
    const before = readJson(firstPath, 'The pre-deployment snapshot');
    const after = snapshotData(secondPath);
    compareAfterMigration(before, after);
    writeSnapshot(thirdPath, after);
    process.stdout.write(`${JSON.stringify(after)}\n`);
    return;
  }
  throw new Error(
    'Usage: node Verify-ClinicalData.js snapshot <data-dir> <output.json>\n' +
    '   or: node Verify-ClinicalData.js compare <before.json> <data-dir> ' +
    '<after.json>',
  );
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  canonicalProfile,
  compareAfterMigration,
  parseCsv,
  requiredCsvColumns,
  snapshotData,
};
