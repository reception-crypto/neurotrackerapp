require('dotenv').config();

const express = require('express');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const basicAuth = require('basic-auth');
const PDFDocument = require('pdfkit');
const { version: backendVersion } = require('./package.json');
const {
  createIdentityStore,
  formatCode,
  normaliseCode,
  supportId,
} = require('./identity_store');
const {
  canonicalRecordsForClinicalProfile,
  isIndependentClinicalProfile,
  maximumIndependentSymptoms,
  normaliseClinicalProfile,
  profileMinimumBuild,
  values,
} = require('./clinical_profiles');
const {
  catalogVersion,
  createDisorderCatalogStore,
} = require('./disorder_catalog');
const {
  createPortalUserStore,
  drPascoePermissions,
  permissionDefinitions,
} = require('./portal_users');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST ||
  (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
const identitySecret = process.env.IDENTITY_SECRET || 'development-only-identity-secret-change-me';
const adminUser = process.env.ADMIN_USER || process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-admin-password';
const reviewEnrolmentCode = normaliseCode(
  process.env.REVIEW_ENROLMENT_CODE || '',
);
const reviewPatientIdPrefix = String(
  process.env.REVIEW_PATIENT_ID_PREFIX || '',
).trim();
const reviewDisplayName = String(
  process.env.REVIEW_DISPLAY_NAME || '',
).trim();
const latestMobileBuild = Number(process.env.LATEST_MOBILE_BUILD || 7);
const minimumMobileBuild = Number(
  process.env.MIN_SUPPORTED_MOBILE_BUILD || 7,
);
const publicBaseUrl = String(
  process.env.PUBLIC_BASE_URL ||
    'https://tracker.melindapascoeneurology.com',
).replace(/\/+$/, '');
const googlePlayUrl = String(
  process.env.GOOGLE_PLAY_URL ||
    'https://play.google.com/store/apps/details?id=au.com.pascoeneurology.neurosol',
).trim();
const appStoreUrl = String(process.env.APP_STORE_URL || '').trim();
const customDisordersEnabled = /^(1|true|yes)$/i.test(
  String(process.env.ENABLE_CUSTOM_DISORDERS || '').trim(),
);
const independentProfilesEnabled = /^(1|true|yes)$/i.test(
  String(process.env.ENABLE_INDEPENDENT_PROFILES || '').trim(),
);
const enrolmentIncidentLockdown = /^(1|true|yes)$/i.test(
  String(process.env.ENROLMENT_INCIDENT_LOCKDOWN || '').trim(),
);
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const csvPath = path.join(dataDir, 'symptom_entries.csv');
const disorderCatalog = createDisorderCatalogStore({ dataDir });
const identityStore = createIdentityStore({
  dataDir,
  secret: identitySecret,
  disorderCatalog,
});
const portalUserStore = createPortalUserStore({ dataDir });
const portalRequestContext = new AsyncLocalStorage();

const csvColumns = ['ReceivedAt','Date','Time','Patient','Track','Disorder','Symptom','Score','WellnessPercent','SubmissionId','PatientId','ProfileRevision','DisorderId','SymptomId','PayloadSchemaVersion','ProfileDisorderIds','ProfileDisorders'];

const reviewConfigurationPresent = Boolean(
  reviewEnrolmentCode || reviewPatientIdPrefix || reviewDisplayName,
);
const reviewConfigurationValid = !reviewConfigurationPresent || (
  reviewEnrolmentCode.length === 12 &&
  reviewPatientIdPrefix.startsWith('pt-review-') &&
  reviewPatientIdPrefix.length <= 80 &&
  reviewDisplayName.length > 0 &&
  reviewDisplayName.length <= 160
);

if (!reviewConfigurationValid) {
  throw new Error(
    'Google Play review access requires a 12-character code, a ' +
    'pt-review- PatientId prefix, and a display name.',
  );
}

if (
  !Number.isInteger(latestMobileBuild) ||
  !Number.isInteger(minimumMobileBuild) ||
  latestMobileBuild < 7 ||
  minimumMobileBuild < 6 ||
  minimumMobileBuild > latestMobileBuild
) {
  throw new Error(
    'LATEST_MOBILE_BUILD and MIN_SUPPORTED_MOBILE_BUILD are invalid.',
  );
}

if (process.env.NODE_ENV === 'production' &&
    minimumMobileBuild !== 7) {
  throw new Error(
    'MIN_SUPPORTED_MOBILE_BUILD must remain 7 while Build 7 is supported.',
  );
}

if (process.env.NODE_ENV === 'production' &&
    (identitySecret.startsWith('development-only') ||
     identitySecret.startsWith('change-this') ||
     identitySecret.startsWith('replace-with') ||
     identitySecret.length < 32 ||
     adminPassword.startsWith('change-this') ||
     adminPassword.startsWith('replace-with') ||
     adminPassword.length < 16)) {
  throw new Error(
    'IDENTITY_SECRET and ADMIN_PASSWORD must be configured for production.',
  );
}

function ensureCsvFile() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, csvColumns.join(',') + '\n', 'utf8');
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function looksLikeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function looksLikeTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(value || ''));
}

function looksLikeTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function validScore(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 10;
}

function validSubmittedScore(value) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10;
}

function validWellness(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function validSubmittedWellness(value) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 10 &&
    value <= 100 &&
    value % 10 === 0;
}

function validClinicalLabel(value, maximumLength = 160) {
  const text = String(value || '');
  return text.trim().length > 0 &&
    text.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(text);
}

function recordIdentifiers(disorder, symptom, disorderId = '', symptomId = '') {
  const suppliedDisorderId = String(disorderId || '').trim();
  const suppliedSymptomId = String(symptomId || '').trim();
  let definition = null;
  try {
    definition = suppliedDisorderId
      ? disorderCatalog.findDisorder({
          id: suppliedDisorderId,
          includeInactive: true,
        })
      : disorderCatalog.findDisorder({
          displayName: disorder,
          includeInactive: true,
        });
  } catch (_) {
    definition = null;
  }
  if (!definition) {
    try {
      definition = disorderCatalog.findDisorder({
        displayName: disorder,
        includeInactive: true,
      });
    } catch (_) {
      definition = null;
    }
  }
  const canonicalDisorderId = definition?.id || '';
  let symptomDefinition = null;
  try {
    symptomDefinition = definition
      ? disorderCatalog.findSymptom(definition, {
          id: suppliedSymptomId,
        }) || disorderCatalog.findGlobalSymptom({ id: suppliedSymptomId })
      : disorderCatalog.findGlobalSymptom({
          id: suppliedSymptomId,
        });
  } catch (_) {
    symptomDefinition = null;
  }
  if (!symptomDefinition) {
    symptomDefinition = definition
      ? disorderCatalog.findSymptom(definition, { displayName: symptom }) ||
        disorderCatalog.findGlobalSymptom({ displayName: symptom })
      : disorderCatalog.findGlobalSymptom({ displayName: symptom });
  }
  return {
    disorderId: canonicalDisorderId,
    symptomId: symptomDefinition?.id || '',
  };
}

function normalisedRecord(receivedAt, date, time, patient, track, disorder, symptom, score, wellness, submissionId = '', patientId = '', profileRevision = '', disorderId = '', symptomId = '', payloadSchemaVersion = 1, profileDisorderIds = '', profileDisorders = '') {
  const schemaVersion = Number(payloadSchemaVersion);
  const independentRecord = schemaVersion === 3;
  if (
    !looksLikeDate(date) ||
    !patient ||
    (!independentRecord && !disorder) ||
    !symptom ||
    !validScore(score)
  ) return null;
  const identifiers = recordIdentifiers(
    disorder,
    symptom,
    disorderId,
    symptomId,
  );
  return {
    ReceivedAt: receivedAt || `${date}T${time || '00:00'}:00`,
    Date: date,
    Time: time || '',
    Patient: patient,
    Track: track || 'Primary',
    Disorder: disorder,
    Symptom: symptom,
    Score: String(Number(score)),
    WellnessPercent: validWellness(wellness) ? String(Number(wellness)) : '',
    SubmissionId: String(submissionId || ''),
    PatientId: String(patientId || ''),
    ProfileRevision: String(profileRevision || ''),
    DisorderId: identifiers.disorderId,
    SymptomId: identifiers.symptomId,
    PayloadSchemaVersion: [1, 2, 3].includes(schemaVersion)
      ? String(schemaVersion)
      : '1',
    ProfileDisorderIds: independentRecord
      ? String(profileDisorderIds || '')
      : '',
    ProfileDisorders: independentRecord
      ? String(profileDisorders || '')
      : '',
  };
}

function submissionRecordKey(record) {
  const disorder = String(record.disorder ?? record.Disorder ?? '');
  const symptom = String(record.symptom ?? record.Symptom ?? '');
  const identifiers = recordIdentifiers(
    disorder,
    symptom,
    record.disorderId ?? record.DisorderId ?? '',
    record.symptomId ?? record.SymptomId ?? '',
  );
  return JSON.stringify([
    String(record.track ?? record.Track ?? ''),
    identifiers.disorderId,
    disorder,
    identifiers.symptomId,
    symptom,
    Number(record.score ?? record.Score),
  ]);
}

function isExactSubmissionRetry(
  rows,
  { patientId, date, time, wellness, profileRevision, records },
) {
  if (rows.length !== records.length) return false;
  if (rows.some(row =>
    patientKey(row) !== patientId ||
    row.Date !== date ||
    row.Time !== time ||
    Number(row.WellnessPercent) !== Number(wellness) ||
    String(row.ProfileRevision || '') !== String(profileRevision || '')
  )) {
    return false;
  }
  const stored = rows.map(submissionRecordKey).sort();
  const submitted = records.map(submissionRecordKey).sort();
  return JSON.stringify(stored) === JSON.stringify(submitted);
}

function expandLegacyWideRow(values, hasReceivedAt = false) {
  const offset = hasReceivedAt ? 1 : 0;
  const receivedAt = hasReceivedAt ? values[0] : '';
  const date = values[offset];
  const time = values[offset + 1];
  const patient = values[offset + 2];
  const disorder = values[offset + 3];
  const wellness = values[offset + 10];
  const records = [];
  for (const [symptomIndex, scoreIndex] of [[4,5],[6,7],[8,9]]) {
    const record = normalisedRecord(
      receivedAt,
      date,
      time,
      patient,
      'Primary',
      disorder,
      values[offset + symptomIndex],
      values[offset + scoreIndex],
      wellness,
    );
    if (record) records.push(record);
  }
  return records;
}

function normaliseCsvRows(parsed) {
  if (!parsed.length) return [];
  const headers = parsed[0].map(h => String(h || '').trim());
  const dataRows = parsed.slice(1);
  const normalised = [];

  const headerIndex = Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), i]));
  const isNormalHeader = headers.includes('Symptom') && headers.includes('Score');
  const isWideHeader = headers.some(h => /^Symptom_?1$/i.test(h)) || headers.includes('Symptom1');

  for (const values of dataRows) {
    if (!values.some(v => String(v || '').trim())) continue;

    // Independent Build 8 schema with profile-level disorder snapshots.
    if (values.length === 17 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 17));
      if (record) normalised.push(record);
      continue;
    }

    // Additive Build 8 canonical schema with payload schema retained.
    if (values.length === 15 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 15));
      if (record) normalised.push(record);
      continue;
    }

    // Early Build 8 schema. Missing schema-version data is Build 7/schema 1.
    if (values.length === 14 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 14));
      if (record) normalised.push(record);
      continue;
    }

    // Build 7 schema with profile revision but no catalogue identifiers.
    if (values.length === 12 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 12));
      if (record) normalised.push(record);
      continue;
    }

    // Build 6 schema without a clinical profile revision.
    if (values.length === 11 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 11));
      if (record) normalised.push(record);
      continue;
    }

    // Previous server schema without identifiers.
    if (values.length === 9 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 9));
      if (record) normalised.push(record);
      continue;
    }

    // Local app schema: Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent
    if (values.length === 8 && looksLikeDate(values[0])) {
      const record = normalisedRecord('', ...values);
      if (record) normalised.push(record);
      continue;
    }

    // Older wide schemas, with or without ReceivedAt.
    if (values.length >= 12 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      normalised.push(...expandLegacyWideRow(values, true));
      continue;
    }
    if (values.length >= 11 && looksLikeDate(values[0])) {
      normalised.push(...expandLegacyWideRow(values, false));
      continue;
    }

    // Header-driven fallback for consistently formatted files.
    if (isNormalHeader) {
      const get = name => values[headerIndex[name.toLowerCase()]] || '';
      const record = normalisedRecord(
        get('ReceivedAt'), get('Date'), get('Time'), get('Patient'), get('Track'),
        get('Disorder'), get('Symptom'), get('Score'), get('WellnessPercent'),
        get('SubmissionId'), get('PatientId'), get('ProfileRevision'),
        get('DisorderId'), get('SymptomId'), get('PayloadSchemaVersion') || 1,
        get('ProfileDisorderIds'), get('ProfileDisorders'),
      );
      if (record) normalised.push(record);
      continue;
    }
    if (isWideHeader) {
      const hasReceived = headers[0] === 'ReceivedAt';
      normalised.push(...expandLegacyWideRow(values, hasReceived));
    }
  }

  return normalised;
}

function serialiseNormalisedRows(rows) {
  const lines = [csvColumns.join(',')];
  for (const row of rows) {
    lines.push(csvColumns.map(column => escapeCsv(row[column] || '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function writeCsvAtomically(rows) {
  fs.mkdirSync(dataDir, { recursive: true });
  const temporaryPath = `${csvPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, serialiseNormalisedRows(rows), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, csvPath);
}

function repairCsvIfNeeded() {
  ensureCsvFile();
  const original = fs.readFileSync(csvPath, 'utf8');
  const parsed = parseCsv(original);
  if (!parsed.length) return;
  const headers = parsed[0].map(h => String(h || '').trim());
  const rows = normaliseCsvRows(parsed);
  const repaired = serialiseNormalisedRows(rows);
  const canonicalHeader = csvColumns.join(',');
  const needsRepair = headers.join(',') !== canonicalHeader || original !== repaired;
  if (!needsRepair) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dataDir, `symptom_entries.backup-${stamp}.csv`);
  fs.copyFileSync(csvPath, backupPath);
  fs.writeFileSync(csvPath, repaired, 'utf8');
  console.log(`NeuroSol CSV normalised: ${rows.length} rows. Backup: ${backupPath}`);
}

function readRows() {
  ensureCsvFile();
  const parsed = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const rows = normaliseCsvRows(parsed);
  return rows.map(row => ({
    ...row,
    ScoreNumber: Number(row.Score),
    WellnessNumber: Number(row.WellnessPercent || 0),
  })).filter(row => Number.isFinite(row.ScoreNumber));
}

function disorderKey(row) {
  const id = String(row?.DisorderId || '').trim();
  return id || `legacy:${String(row?.Disorder || '').trim()}`;
}

function splitProfileValues(value) {
  return String(value || '')
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);
}

function rowDisorderIds(row) {
  const profileIds = splitProfileValues(row?.ProfileDisorderIds);
  if (profileIds.length) return [...new Set(profileIds)];
  const legacyId = disorderKey(row);
  return legacyId && legacyId !== 'legacy:' ? [legacyId] : [];
}

function rowHasDisorder(row, disorderId) {
  const id = String(disorderId || '').trim();
  return !id || rowDisorderIds(row).includes(id);
}

function rowDisorderLabel(row) {
  const profileNames = splitProfileValues(row?.ProfileDisorders);
  return profileNames.length
    ? profileNames.join(', ')
    : String(row?.Disorder || '');
}

function disorderChoices(rows) {
  const choices = new Map();
  for (const row of rows) {
    const ids = rowDisorderIds(row);
    const profileNames = splitProfileValues(row.ProfileDisorders);
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      if (!id || id === 'legacy:') continue;
      const existing = choices.get(id);
      if (
        !existing ||
        String(row.ReceivedAt || '').localeCompare(existing.receivedAt) > 0
      ) {
        choices.set(id, {
          id,
          displayName: profileNames[index] || row.Disorder || id,
          receivedAt: String(row.ReceivedAt || ''),
        });
      }
    }
  }
  for (const choice of choices.values()) {
    if (choice.id.startsWith('legacy:')) continue;
    const registered = disorderCatalog.findDisorder({
      id: choice.id,
      includeInactive: true,
    });
    if (registered) choice.displayName = registered.displayName;
  }
  return [...choices.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'en-AU')
  );
}

function resolveDisorderKey(rows, suppliedId = '', suppliedName = '') {
  const requestedId = String(suppliedId || '').trim();
  const requestedName = String(suppliedName || '').trim();
  const choices = disorderChoices(rows);
  if (requestedId && choices.some(choice => choice.id === requestedId)) {
    return requestedId;
  }
  if (requestedName) {
    return choices.find(choice => choice.displayName === requestedName)?.id || '';
  }
  return '';
}

function disorderLabel(rows, id) {
  return disorderChoices(rows).find(choice => choice.id === id)?.displayName ||
    '';
}

function bearerToken(req) {
  const header = String(req.header('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function mobileBuild(req) {
  const supplied = Number(req.header('x-neurosol-build'));
  return Number.isInteger(supplied) && supplied > 0 ? supplied : 6;
}

function payloadSchemaVersion(body = {}) {
  if (
    body.schemaVersion == null ||
    String(body.schemaVersion).trim() === ''
  ) {
    return 1;
  }
  const supplied = Number(body.schemaVersion);
  return Number.isInteger(supplied) && [1, 2, 3].includes(supplied)
    ? supplied
    : null;
}

function advertisedLatestBuild(req) {
  const clientBuild = mobileBuild(req);
  // Build 7 treats latestBuild as mandatory. While it remains supported,
  // advertise its own compatible build rather than turning Build 8 into a
  // global forced update. Build-specific profile gates still return 426.
  if (
    clientBuild >= minimumMobileBuild &&
    clientBuild <= latestMobileBuild
  ) {
    return clientBuild;
  }
  return latestMobileBuild;
}

function supportsClinicManagedProfile(req) {
  return mobileBuild(req) >= 7 &&
    req.header('x-neurosol-profile') === 'clinic-managed-v1';
}

function supportsCanonicalDisorders(req) {
  return mobileBuild(req) >= 8 &&
    req.header('x-neurosol-disorders') === 'canonical-v1';
}

function supportsIndependentProfiles(req) {
  return supportsCanonicalDisorders(req) &&
    req.header('x-neurosol-profile-model') === 'independent-v1';
}

function sendUpdateRequired(res, requiredBuild = minimumMobileBuild) {
  res.set('Cache-Control', 'no-store');
  return res.status(426).json({
    error: 'This version of NeuroSol Symptom Diary is no longer supported.',
    code: 'app_update_required',
    minimumBuild: requiredBuild,
    latestBuild: Math.max(latestMobileBuild, requiredBuild),
    googlePlayUrl,
    appStoreUrl: appStoreUrl || undefined,
  });
}

function requireSupportedMobileBuild(req, res, next) {
  if (mobileBuild(req) < minimumMobileBuild) {
    return sendUpdateRequired(res);
  }
  next();
}

function requireIncidentClear(req, res, next) {
  if (!enrolmentIncidentLockdown) return next();
  res.set({
    'Cache-Control': 'no-store',
    'Retry-After': '3600',
  });
  return res.status(503).json({
    error: 'Clinic syncing is temporarily paused while enrolment identities are repaired.',
    code: 'clinic_identity_recovery',
  });
}

function matchesReviewEnrolmentCode(value) {
  if (!reviewEnrolmentCode) return false;
  const supplied = Buffer.from(normaliseCode(value), 'utf8');
  const expected = Buffer.from(reviewEnrolmentCode, 'utf8');
  return supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

function requireDeviceIdentity(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const identity = identityStore.authenticate(bearerToken(req), {
    mobileBuild: mobileBuild(req),
    supportsClinicManagedProfile: supportsClinicManagedProfile(req),
    supportsCanonicalDisorders: supportsCanonicalDisorders(req),
    supportsIndependentProfiles: supportsIndependentProfiles(req),
  });
  if (identity) {
    req.deviceIdentity = identity;
    return next();
  }
  return res.status(401).json({
    error: 'This device is not enrolled or its access has been revoked.',
    code: 'device_not_authorised',
  });
}

function recordAcceptedPayloadSchema(req, schemaVersion) {
  try {
    identityStore.recordPayloadSchema(bearerToken(req), schemaVersion);
  } catch (error) {
    console.warn(
      `NeuroSol compatibility observation could not be recorded: ` +
      `${error.message}`,
    );
  }
}

function adminCsrfToken() {
  return crypto
    .createHmac('sha256', identitySecret)
    .update('neurosol-clinician-portal-forms')
    .digest('hex');
}

function validAdminCsrf(value) {
  const supplied = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(adminCsrfToken(), 'utf8');
  return supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

function requireAdminCsrf(req, res, next) {
  if (!validAdminCsrf(req.body?.csrfToken)) {
    return res.status(403).send('The form expired or could not be verified.');
  }
  next();
}

function securePortalResponse(res) {
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
}

function sameCredential(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requirePortalUser(req, res, next) {
  const user = basicAuth(req);
  let portalUser = null;
  if (user && sameCredential(user.name, adminUser) &&
      sameCredential(user.pass, adminPassword)) {
    portalUser = {
      username: adminUser,
      isAdmin: true,
      permissions: permissionDefinitions.map(item => item.id),
    };
  } else if (user) {
    const stored = portalUserStore.authenticate(user.name, user.pass);
    if (stored) portalUser = { ...stored, isAdmin: false };
  }
  if (!portalUser) {
    res.set('WWW-Authenticate', 'Basic realm="NeuroSol Admin"');
    return res.status(401).send('Authentication required.');
  }
  req.portalUser = portalUser;
  securePortalResponse(res);
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.portalUser?.isAdmin || req.portalUser?.permissions?.includes(permission)) {
      return next();
    }
    return res.status(403).send(pageShell(
      'Access denied',
      '<section class="panel"><h2>Access denied</h2><p>This account does not have permission to use that part of the clinician portal.</p></section>',
    ));
  };
}

function requireSystemAdmin(req, res, next) {
  if (req.portalUser?.isAdmin) return next();
  return res.status(403).send(pageShell(
    'Administrator access required',
    '<section class="panel"><h2>Administrator access required</h2><p>Only the protected admin account can manage clinician portal users.</p></section>',
  ));
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function patientKey(row) {
  const patientId = String(row?.PatientId || '').trim();
  if (patientId) return patientId;
  const legacyName = String(row?.Patient || '').trim();
  return legacyName ? `legacy:${legacyName}` : '';
}

function patientDirectory(rows) {
  const directory = new Map();
  for (const row of rows) {
    const key = patientKey(row);
    const displayName = String(row.Patient || '').trim() || 'Unnamed patient';
    if (!key) continue;
    const timestamp = row.ReceivedAt || `${row.Date || ''}T${row.Time || ''}`;
    const current = directory.get(key);
    if (!current || timestamp >= current.latestTimestamp) {
      const isLegacy = key.startsWith('legacy:');
      const shortId = isLegacy ? 'Legacy record' : supportId(key);
      directory.set(key, {
        patientId: key,
        displayName,
        latestTimestamp: timestamp,
        supportId: shortId,
        label: isLegacy ? `${displayName} (legacy record)` : `${displayName} (${shortId})`,
      });
    }
  }
  const patients = identityStore.snapshot().patients;
  for (const [patientId, patient] of Object.entries(patients)) {
    const current = directory.get(patientId);
    if (!current || !patient.displayName) continue;
    const shortId = supportId(patientId);
    directory.set(patientId, {
      ...current,
      displayName: patient.displayName,
      supportId: shortId,
      quarantined: Boolean(patient.quarantinedAt),
      label: patient.quarantinedAt
        ? `[QUARANTINED COLLISION] ${patient.displayName} (${shortId})`
        : `${patient.displayName} (${shortId})`,
    });
  }
  return directory;
}

function resolvePatientKey(rows, requestedPatientId, legacyName = '') {
  const directory = patientDirectory(rows);
  const requested = String(requestedPatientId || '').trim();
  if (requested && directory.has(requested)) return requested;
  const oldName = String(legacyName || '').trim();
  if (oldName) {
    const match = [...directory.values()].find(patient => patient.displayName === oldName);
    if (match) return match.patientId;
  }
  return [...directory.values()].find(patient => !patient.quarantined)
    ?.patientId || [...directory.keys()][0] || '';
}

function unique(rows, key) { return [...new Set(rows.map(r => r[key]).filter(Boolean))].sort(); }
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0; }
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a,b)=>a-b), m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
function round1(n) { return Math.round(n * 10) / 10; }
function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v-m)**2)));
}
function isoWeekStart(dateText) {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0,10);
}
function periodKey(dateText, aggregation) {
  if (aggregation === 'daily') return dateText;
  if (aggregation === 'weekly') return isoWeekStart(dateText);
  const d = new Date(`${dateText}T00:00:00`);
  if (aggregation === 'monthly') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  const start = new Date(d.getFullYear(),0,1);
  const day = Math.floor((d-start)/86400000);
  const fortnight = Math.floor(day/14)*14;
  start.setDate(start.getDate()+fortnight);
  return start.toISOString().slice(0,10);
}
function dateLabel(dateText, aggregation) {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  if (aggregation === 'monthly') return d.toLocaleDateString('en-AU',{month:'short',year:'numeric'});
  return d.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
}

function utcDateFromIso(dateText) {
  if (!looksLikeDate(dateText)) return null;
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function addIsoDays(dateText, amount) {
  const date = utcDateFromIso(dateText);
  if (!date) return dateText;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function todayIso(timeZone = process.env.APP_TIME_ZONE || 'Australia/Brisbane') {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function metricLabel(metric) {
  if (metric === 'wellness') return 'Wellness';
  if (metric === 'symptom') return 'Average symptom score';
  if (metric.startsWith('symptom:')) return metric.slice('symptom:'.length);
  return 'Metric';
}

function buildCalendarDays(rows, metric, requestedDays = 30, endDate = todayIso()) {
  const range = [30, 60, 90].includes(Number(requestedDays)) ? Number(requestedDays) : 30;
  const safeEndDate = utcDateFromIso(endDate) ? endDate : todayIso();
  const startDate = addIsoDays(safeEndDate, -(range - 1));
  const symptomMetric = metric.startsWith('symptom:') ? metric.slice('symptom:'.length) : '';
  const wellnessMetric = metric === 'wellness';
  const buckets = new Map();

  for (const row of rows) {
    if (!utcDateFromIso(row.Date)) continue;
    if (!buckets.has(row.Date)) buckets.set(row.Date, { values: [], seen: new Set() });
    const bucket = buckets.get(row.Date);

    if (wellnessMetric) {
      const value = Number(row.WellnessPercent);
      if (row.WellnessPercent === '' || !Number.isFinite(value)) continue;
      const submissionKey = row.SubmissionId || row.ReceivedAt || `${row.Date}|${row.Time}|${value}`;
      if (bucket.seen.has(submissionKey)) continue;
      bucket.seen.add(submissionKey);
      bucket.values.push(value);
      continue;
    }

    if (symptomMetric && row.Symptom !== symptomMetric) continue;
    if (Number.isFinite(row.ScoreNumber)) bucket.values.push(row.ScoreNumber);
  }

  const days = [];
  for (let index = 0; index < range; index++) {
    const date = addIsoDays(startDate, index);
    const values = buckets.get(date)?.values || [];
    days.push({
      date,
      recorded: values.length > 0,
      value: values.length ? round1(mean(values)) : null,
    });
  }

  return {
    days,
    range,
    startDate,
    endDate: safeEndDate,
    isWellness: wellnessMetric,
    label: metricLabel(metric),
  };
}

function calendarDateLabel(dateText, includeYear = false) {
  const date = utcDateFromIso(dateText);
  if (!date) return dateText;
  return date.toLocaleDateString('en-AU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

function renderMetricCalendar(rows, metric, requestedDays = 30, endDate = todayIso()) {
  const calendar = buildCalendarDays(rows, metric, requestedDays, endDate);
  const firstDate = utcDateFromIso(calendar.startDate);
  const firstColumn = firstDate ? ((firstDate.getUTCDay() + 6) % 7) + 1 : 1;
  const maxValue = calendar.isWellness ? 100 : 10;
  const colourClass = calendar.isWellness ? 'wellness' : 'symptom';
  const unit = calendar.isWellness ? '%' : '/10';
  const weekdayHeaders = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map(day => `<div class="calendar-weekday">${day}</div>`).join('');

  const dayCards = calendar.days.map((day, index) => {
    const date = utcDateFromIso(day.date);
    const dayNumber = date?.getUTCDate() || '';
    const showMonth = index === 0 || dayNumber === 1;
    const month = date ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()] : '';
    const dateText = showMonth ? `${dayNumber} ${month}` : String(dayNumber);
    const valueText = day.recorded ? `${day.value}${unit}` : 'No entry';
    const title = `${calendarDateLabel(day.date, true)} — ${calendar.label}: ${valueText}`;
    const full = day.recorded && day.value >= maxValue;
    const classes = [
      'calendar-day',
      colourClass,
      day.recorded ? 'recorded' : 'no-entry',
      full ? 'full' : '',
    ].filter(Boolean).join(' ');
    const firstStyle = index === 0 ? ` style="grid-column-start:${firstColumn}"` : '';
    const markerSize = day.recorded && day.value > 0 && !full
      ? Math.round(6 + (Math.min(maxValue, day.value) / maxValue) * 32)
      : 0;
    const marker = markerSize
      ? `<span class="calendar-dot" style="width:${markerSize}px;height:${markerSize}px"></span>`
      : '';

    return `<div class="${classes}"${firstStyle} title="${html(title)}" aria-label="${html(title)}">
      <span class="calendar-date">${html(dateText)}</span>${marker}
    </div>`;
  }).join('');

  const legend = calendar.isWellness
    ? `<span><i class="calendar-key missing"></i>No entry</span>
       <span><i class="calendar-key dot wellness small"></i>30%</span>
       <span><i class="calendar-key dot wellness medium"></i>60%</span>
       <span><i class="calendar-key full wellness"></i>100%</span>`
    : `<span><i class="calendar-key zero"></i>0 recorded</span>
       <span><i class="calendar-key dot symptom small"></i>3/10</span>
       <span><i class="calendar-key dot symptom medium"></i>6/10</span>
       <span><i class="calendar-key full symptom"></i>10/10</span>
       <span><i class="calendar-key missing"></i>No entry</span>`;

  return `<div class="calendar-view" data-calendar-days="${calendar.range}">
    <div class="calendar-range">${html(calendarDateLabel(calendar.startDate, true))} – ${html(calendarDateLabel(calendar.endDate, true))}</div>
    <div class="calendar-scroll"><div class="calendar-frame">
      <div class="calendar-weekdays">${weekdayHeaders}</div>
      <div class="calendar-grid">${dayCards}</div>
    </div></div>
    <div class="calendar-legend">${legend}</div>
  </div>`;
}

function patientSeries(
  rows,
  disorderId,
  metric,
  aggregation='weekly',
  selectedPatients=[],
  patientNames=null,
) {
  const symptomMetric = metric.startsWith('symptom:') ? metric.slice('symptom:'.length) : '';
  const directory = patientNames || patientDirectory(rows);
  const filtered = rows.filter(r =>
    rowHasDisorder(r, disorderId) &&
    (!selectedPatients.length || selectedPatients.includes(patientKey(r))) &&
    (selectedPatients.length > 0 || !directory.get(patientKey(r))?.quarantined) &&
    (!symptomMetric || r.Symptom === symptomMetric)
  );
  const byPatient = new Map();
  for (const r of filtered) {
    const patient = patientKey(r);
    if (!patient || !r.Date) continue;
    const key = periodKey(r.Date, aggregation);
    if (!byPatient.has(patient)) byPatient.set(patient, new Map());
    const period = byPatient.get(patient);
    if (!period.has(key)) period.set(key, { scores: [], wellness: [], wellnessSeen: new Set() });
    const bucket = period.get(key);
    if (Number.isFinite(r.ScoreNumber)) bucket.scores.push(r.ScoreNumber);
    const wellnessKey = r.SubmissionId || `${r.Date}|${r.Time}|${r.WellnessNumber}`;
    if (r.WellnessNumber > 0 && !bucket.wellnessSeen.has(wellnessKey)) {
      bucket.wellnessSeen.add(wellnessKey);
      bucket.wellness.push(r.WellnessNumber);
    }
  }
  return [...byPatient.entries()].map(([patient, periods]) => ({
    patient,
    label: directory.get(patient)?.label || patient,
    series: [...periods.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,b]) => ({
      date,
      value: round1(metric === 'wellness' ? mean(b.wellness) : mean(b.scores))
    })).filter(p=>Number.isFinite(p.value))
  })).filter(p=>p.series.length);
}

function cohortSeries(series, metric) {
  const dates = [...new Set(series.flatMap(p=>p.series.map(x=>x.date)))].sort();
  const maxY = metric === 'wellness' ? 100 : 10;
  return dates.map(date => {
    const values = series.map(p=>p.series.find(x=>x.date===date)?.value).filter(Number.isFinite);
    const avg = mean(values), sd = stddev(values);
    return { date, average:round1(avg), median:round1(median(values)), lower:round1(Math.max(0,avg-sd)), upper:round1(Math.min(maxY,avg+sd)), count:values.length };
  }).filter(x=>x.count);
}

function classifyPatientTrend(p, metric) {
  if (p.series.length < 2) return 'Insufficient data';
  const first = mean(p.series.slice(0,Math.min(3,p.series.length)).map(x=>x.value));
  const last = mean(p.series.slice(-Math.min(3,p.series.length)).map(x=>x.value));
  const delta = last-first;
  const threshold = metric === 'wellness' ? 8 : 0.8;
  if (metric === 'wellness') return delta > threshold ? 'Improving' : delta < -threshold ? 'Deteriorating' : 'Stable';
  return delta < -threshold ? 'Improving' : delta > threshold ? 'Deteriorating' : 'Stable';
}

function svgChart(series, metric, aggregation, mode='summary', selectedPatient='') {
  const width=1120, height=540, left=74, right=28, top=42, bottom=64;
  const maxY = metric==='wellness'?100:10;
  const allDates=[...new Set(series.flatMap(p=>p.series.map(x=>x.date)))].sort();
  if (!allDates.length) return '<p class="empty">No matching data.</p>';
  const index=new Map(allDates.map((d,i)=>[d,i]));
  const x=d=>left+((index.get(d)||0)/Math.max(1,allDates.length-1))*(width-left-right);
  const y=v=>height-bottom-(v/maxY)*(height-top-bottom);
  const ticks=metric==='wellness'?[0,20,40,60,80,100]:[0,2,4,6,8,10];
  const summary=cohortSeries(series,metric);
  const grid=ticks.map(t=>`<line x1="${left}" x2="${width-right}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e7eb"/><text x="${left-14}" y="${y(t)+4}" text-anchor="end" class="axis">${t}${metric==='wellness'?'%':''}</text>`).join('');
  const step=Math.max(1,Math.ceil(allDates.length/9));
  const labels=allDates.map((d,i)=>(i%step===0||i===allDates.length-1)?`<text x="${x(d)}" y="${height-24}" text-anchor="middle" class="axis">${html(dateLabel(d,aggregation))}</text>`:'').join('');
  const palette=['#2563eb','#059669','#dc2626','#7c3aed','#d97706','#0891b2','#be123c','#4f46e5','#16a34a','#9333ea'];
  let lines='';
  if (mode==='summary') {
    lines=series.map(p=>{
      const pts=p.series.map(q=>`${x(q.date)},${y(q.value)}`).join(' ');
      return `<polyline class="patient-faint" points="${pts}"><title>${html(p.label || p.patient)}</title></polyline>`;
    }).join('');
    const upper=summary.map(q=>`${x(q.date)},${y(q.upper)}`).join(' ');
    const lower=[...summary].reverse().map(q=>`${x(q.date)},${y(q.lower)}`).join(' ');
    lines+=`<polygon points="${upper} ${lower}" fill="#93c5fd" opacity="0.28"/>`;
    lines+=`<polyline class="cohort" points="${summary.map(q=>`${x(q.date)},${y(q.average)}`).join(' ')}"/>`;
    lines+=`<polyline class="median" points="${summary.map(q=>`${x(q.date)},${y(q.median)}`).join(' ')}"/>`;
    lines+=summary.map(q=>`<circle cx="${x(q.date)}" cy="${y(q.average)}" r="4" fill="#1d4ed8"><title>${html(dateLabel(q.date,aggregation))}: mean ${q.average}${metric==='wellness'?'%':''}; median ${q.median}; n=${q.count}</title></circle>`).join('');
  } else {
    lines=series.map((p,i)=>{
      const active=!selectedPatient||selectedPatient===p.patient;
      const pts=p.series.map(q=>`${x(q.date)},${y(q.value)}`).join(' ');
      return `<polyline fill="none" stroke="${palette[i%palette.length]}" stroke-width="${active?3:1.2}" stroke-opacity="${active?0.95:0.18}" points="${pts}"><title>${html(p.label || p.patient)}</title></polyline>`;
    }).join('');
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
    <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#ffffff"/>
    ${grid}<line x1="${left}" x2="${left}" y1="${top}" y2="${height-bottom}" stroke="#9ca3af"/><line x1="${left}" x2="${width-right}" y1="${height-bottom}" y2="${height-bottom}" stroke="#9ca3af"/>
    ${lines}${labels}
    <text x="18" y="${top-12}" class="axis-title">${metric==='wellness'?'Wellness':'Symptom score'}</text>
  </svg>`;
}

function pageShell(title, body) {
  const portalUser = portalRequestContext.getStore()?.req?.portalUser;
  const can = permission => portalUser?.isAdmin ||
    portalUser?.permissions?.includes(permission);
  const navigation = [
    ['patient_review', '/admin', 'Patient review'],
    ['population_analytics', '/admin/population', 'Population analytics'],
    ['enrolments', '/admin/enrolments', 'Enrolments'],
    ['identity_recovery', '/admin/enrolments/recovery', 'Identity recovery'],
    ['disorders_symptoms', '/admin/disorders', 'Disorders'],
    ['disorders_symptoms', '/admin/symptoms', 'Symptoms'],
    ['manage_patients', '/admin/patients', 'Manage patients'],
    ['csv_export', '/admin/export.csv', 'CSV export'],
  ].filter(([permission]) => can(permission))
    .map(([, href, label]) => `<a href="${href}">${label}</a>`);
  if (portalUser?.isAdmin) {
    navigation.push('<a href="/admin/users">User accounts</a>');
  }
  const signedIn = portalUser
    ? `<div class="signed-in">Signed in as ${html(portalUser.username)}</div>`
    : '';
  const incidentNotice = enrolmentIncidentLockdown
    ? '<div class="incident-lock"><strong>IDENTITY RECOVERY LOCKDOWN ACTIVE</strong> — mobile enrolment, profile sync, and symptom uploads are paused. Complete identity recovery before reopening mobile access.</div>'
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>
  :root{--bg:#f3f4f6;--panel:#fff;--ink:#111827;--muted:#6b7280;--blue:#2563eb;--line:#e5e7eb;--danger:#b91c1c;--good:#047857}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}header{background:#111827;color:#fff;padding:20px 30px;display:flex;justify-content:space-between;align-items:center}header h1{font-size:24px;margin:0}nav a{color:#bfdbfe;margin-left:18px;text-decoration:none;font-weight:600}main{max-width:1500px;margin:auto;padding:24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:end}.field label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}select,input,button,.button{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#111827;font-size:14px}button,.button{background:var(--blue);color:white;border:none;font-weight:700;cursor:pointer;text-decoration:none;text-align:center;display:inline-block}.button.secondary{background:#374151}.button.danger,button.danger{background:var(--danger)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}.stat .label{font-size:12px;text-transform:uppercase;color:var(--muted);font-weight:700}.stat .value{font-size:27px;font-weight:800;margin-top:5px}.notice{border:2px solid #2563eb;background:#eff6ff;border-radius:12px;padding:18px;margin-bottom:20px}.code{font:800 28px Consolas,monospace;letter-spacing:.08em;margin:10px 0}.inline-form{display:inline}.inline-form button{width:auto;padding:7px 10px}.chart{width:100%;min-height:420px}.axis{font-size:12px;fill:#4b5563}.axis-title{font-size:13px;fill:#374151;font-weight:700}.patient-faint{fill:none;stroke:#64748b;stroke-width:1;stroke-opacity:.16}.cohort{fill:none;stroke:#1d4ed8;stroke-width:4}.median{fill:none;stroke:#7c3aed;stroke-width:2;stroke-dasharray:7 5}.legend{display:flex;gap:20px;flex-wrap:wrap;color:var(--muted);font-size:13px}.swatch{display:inline-block;width:24px;height:4px;margin-right:7px;vertical-align:middle}.table-wrap{overflow:auto;max-height:480px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f8fafc;color:#475569}.flag{color:var(--danger);font-weight:700}.good{color:var(--good);font-weight:700}.muted{color:var(--muted)}.empty{padding:70px;text-align:center;color:var(--muted)}.patient-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:210px;overflow:auto;padding:8px;border:1px solid var(--line);border-radius:9px}.patient-list label{font-size:13px}.patient-list input{width:auto;margin-right:7px}.calendar-range{color:var(--muted);font-size:13px;margin:-4px 0 16px}.calendar-scroll{overflow-x:auto;padding-bottom:4px}.calendar-frame{min-width:560px;max-width:560px}.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(66px,1fr));gap:8px}.calendar-weekdays{margin-bottom:8px}.calendar-weekday{text-align:center;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.calendar-day{position:relative;aspect-ratio:1;min-height:66px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;display:grid;place-items:center;overflow:hidden}.calendar-day.no-entry{border-style:dashed;background:#f8fafc;color:#94a3b8}.calendar-day.full.symptom{background:#dc2626;border-color:#dc2626;color:#fff}.calendar-day.full.wellness{background:#059669;border-color:#059669;color:#fff}.calendar-date{position:absolute;top:7px;left:8px;z-index:2;font-size:11px;font-weight:800}.calendar-dot{display:block;border-radius:50%}.calendar-day.symptom .calendar-dot{background:#dc2626}.calendar-day.wellness .calendar-dot{background:#059669}.calendar-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:var(--muted);font-size:12px;margin-top:16px}.calendar-legend span{display:flex;align-items:center;gap:7px}.calendar-key{display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;position:relative}.calendar-key.dot::after{content:"";display:block;border-radius:50%}.calendar-key.dot.symptom::after{background:#dc2626}.calendar-key.dot.wellness::after{background:#059669}.calendar-key.dot.small::after{width:10px;height:10px}.calendar-key.dot.medium::after{width:17px;height:17px}.calendar-key.full.symptom{background:#dc2626;border-color:#dc2626}.calendar-key.full.wellness{background:#059669;border-color:#059669}.calendar-key.missing{border-style:dashed;background:#f8fafc}@media(max-width:700px){
    main{padding:12px}
    header{padding:14px 12px;display:block;text-align:center}
    header h1{font-size:20px;margin-bottom:12px}
    nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%}
    nav a{margin:0;padding:10px 8px;border:1px solid #334155;border-radius:8px;text-align:center;font-size:13px;line-height:1.2}
    .chart{min-height:300px}
    .toolbar{grid-template-columns:1fr}
    .panel{padding:14px}
    .calendar-scroll{overflow:visible}
    .calendar-frame{min-width:0}
    .calendar-weekdays,.calendar-grid{grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
    .calendar-weekdays{margin-bottom:4px}
    .calendar-day{min-height:0;border-radius:7px}
    .calendar-date{top:4px;left:5px;font-size:9px}
    .calendar-dot{transform:scale(.75)}
  }
  .incident-lock{background:#7f1d1d;color:#fff;padding:14px 24px;text-align:center;border-bottom:4px solid #fca5a5}
  .signed-in{font-size:12px;color:#cbd5e1;text-align:right;margin-top:8px}
  </style></head><body><header><h1>NeuroSol Clinician Portal</h1><div><nav>${navigation.join('')}</nav>${signedIn}</div></header>${incidentNotice}<main>${body}</main></body></html>`;
}

// Validate the catalogue before any profile or CSV migration can write data.
// A corrupt catalogue must stop startup and remain untouched for recovery.
disorderCatalog.snapshot();
const identityMigration = identityStore.migrateCanonicalProfiles();
if (identityMigration.migrated) {
  console.log(
    `NeuroSol identity profiles migrated: ${identityMigration.migratedProfiles}. ` +
    `Backup: ${identityMigration.backupPath}`,
  );
}
const reconciledProfiles = identityStore.reconcileCurrentProfiles();
if (reconciledProfiles) {
  console.log(
    `NeuroSol current profiles reconciled with the disorder catalogue: ` +
    `${reconciledProfiles}.`,
  );
}
repairCsvIfNeeded();
app.use(express.json({limit:'256kb'}));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use('/admin', (req, res, next) =>
  portalRequestContext.run({ req }, next));

app.get('/health',(req,res)=>res.json({
  ok:true,
  backendVersion,
  storage:'csv',
  enrolmentIncidentLockdown,
  disorderCatalogVersion: catalogVersion,
  customDisordersEnabled,
  independentProfilesEnabled,
}));
app.get('/api/mobile-config',(req,res)=>{
  res.set('Cache-Control', 'no-store');
  res.json({
    minimumBuild: minimumMobileBuild,
    latestBuild: advertisedLatestBuild(req),
    googlePlayUrl,
    appStoreUrl: appStoreUrl || undefined,
    clinicManagedProfiles: true,
    canonicalDisorders: true,
    independentProfileModel: true,
    independentProfilesEnabled,
    maximumProfileSymptoms: maximumIndependentSymptoms,
    disorderCatalogVersion: catalogVersion,
    preferredPayloadSchemaVersion: independentProfilesEnabled &&
      supportsIndependentProfiles(req)
      ? 3
      : supportsCanonicalDisorders(req)
      ? 2
      : 1,
    build7Supported: minimumMobileBuild <= 7,
    customDisordersEnabled,
    enrolmentIncidentLockdown,
  });
});

app.get('/enrol',(req,res)=>{
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  const storeButtons = [
    googlePlayUrl
      ? `<a class="button" href="${html(googlePlayUrl)}" rel="noreferrer">Get the Android app</a>`
      : '',
    appStoreUrl
      ? `<a class="button secondary" href="${html(appStoreUrl)}" rel="noreferrer">Get the iPhone app</a>`
      : '',
  ].filter(Boolean).join('');
  return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NeuroSol enrolment</title><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#111827;font-family:Inter,Segoe UI,Arial,sans-serif}.card{max-width:620px;margin:8vh auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.08)}h1{margin-top:0}.code{font:800 clamp(22px,7vw,34px) Consolas,monospace;letter-spacing:.06em;padding:18px;background:#eff6ff;border:2px solid #2563eb;border-radius:12px;text-align:center}.actions{display:grid;gap:10px;margin-top:20px}.button,button{display:block;width:100%;padding:12px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-size:16px;font-weight:700;text-decoration:none;text-align:center;cursor:pointer}.secondary{background:#374151}.muted{color:#4b5563;font-size:14px}@media(max-width:680px){.card{margin:0;min-height:100vh;border:0;border-radius:0;padding:22px}}</style></head><body><main class="card">
      <h1>NeuroSol Symptom Diary</h1>
      <p>Your clinic has prepared your symptom diary. Install or update to the newest app, then enter this one-time code:</p>
      <div class="code" id="code">Checking link…</div>
      <div class="actions"><button type="button" id="copyButton">Copy enrolment code</button>${storeButtons}</div>
      <p class="muted">For privacy, this page does not show your name or clinical profile. Opening this link does not use the code. The code is used only when you submit it inside the app.</p>
    </main><script>
      const compact = location.hash.slice(1).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const code = compact.length === 12 ? compact.match(/.{1,4}/g).join('-') : '';
      document.getElementById('code').textContent = code || 'Invalid link — ask the clinic for a new code';
      document.getElementById('copyButton').disabled = !code;
      document.getElementById('copyButton').addEventListener('click', () => navigator.clipboard.writeText(code));
    </script></body></html>`);
});

const enrolmentAttempts = new Map();
function limitEnrolmentAttempts(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const attempts = (enrolmentAttempts.get(key) || []).filter(value => value > windowStart);
  enrolmentAttempts.set(key, attempts);
  if (attempts.length >= 10) {
    res.set('Retry-After', '900');
    res.set('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Too many enrolment attempts.' });
  }
  req.enrolmentAttemptKey = key;
  next();
}

function recordFailedEnrolment(req) {
  const key = req.enrolmentAttemptKey ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';
  const attempts = enrolmentAttempts.get(key) || [];
  attempts.push(Date.now());
  enrolmentAttempts.set(key, attempts);
}

app.post(
  '/api/enrol',
  requireIncidentClear,
  limitEnrolmentAttempts,
  requireSupportedMobileBuild,
  (req,res)=>{
  res.set('Cache-Control', 'no-store');
  if (matchesReviewEnrolmentCode(req.body?.code)) {
    const expectedPatientId = String(
      req.body?.expectedPatientId || '',
    ).trim();
    const expectedReviewPrefix = `${reviewPatientIdPrefix}-`;
    if (
      expectedPatientId &&
      !expectedPatientId.startsWith(expectedReviewPrefix)
    ) {
      return res.status(409).json({
        error: 'The enrolment code belongs to a different clinic record.',
        code: 'enrolment_patient_mismatch',
      });
    }
    const reviewerPatientId = expectedPatientId ||
      `${reviewPatientIdPrefix}-${crypto.randomUUID()}`;
    const reviewIdentity = identityStore.enrolReusableReviewDevice({
      patientId: reviewerPatientId,
      displayName: reviewDisplayName,
      supportedMobileBuild: mobileBuild(req),
      supportsClinicManagedProfile: supportsClinicManagedProfile(req),
      supportsCanonicalDisorders: supportsCanonicalDisorders(req),
      supportsIndependentProfiles: supportsIndependentProfiles(req),
    });
    return res.status(200).json({
      patientId: reviewIdentity.patientId,
      displayName: reviewIdentity.displayName,
      supportId: reviewIdentity.supportId,
      accessToken: reviewIdentity.accessToken,
      clinicalProfile: reviewIdentity.clinicalProfile,
    });
  }
  const result = identityStore.redeemEnrolmentCode(req.body?.code, {
    expectedPatientId: req.body?.expectedPatientId,
    supportsClinicManagedProfile: supportsClinicManagedProfile(req),
    supportsCanonicalDisorders: supportsCanonicalDisorders(req),
    supportsIndependentProfiles: supportsIndependentProfiles(req),
    supportedMobileBuild: mobileBuild(req),
  });
  if (result.status === 'ok') {
    return res.status(200).json({
      patientId: result.patientId,
      displayName: result.displayName,
      supportId: result.supportId,
      accessToken: result.accessToken,
      clinicalProfile: result.clinicalProfile,
    });
  }
  recordFailedEnrolment(req);
  if (result.status === 'upgrade_required') {
    return sendUpdateRequired(res, result.requiredBuild || 7);
  }
  if (result.status === 'patient_mismatch') {
    return res.status(409).json({
      error: 'The enrolment code belongs to a different clinic record.',
      code: 'enrolment_patient_mismatch',
    });
  }
  if (
    result.status === 'expired' ||
    result.status === 'used' ||
    result.status === 'invalidated'
  ) {
    return res.status(410).json({
      error: 'The enrolment code has expired or has already been used.',
      code: 'enrolment_code_unavailable',
    });
  }
  return res.status(404).json({
    error: 'The enrolment code is invalid.',
    code: 'enrolment_code_invalid',
  });
});

app.get(
  '/api/profile',
  requireIncidentClear,
  requireDeviceIdentity,
  requireSupportedMobileBuild,
  (req,res)=>{
    const patient = req.deviceIdentity.patient;
    if (!patient?.clinicalProfile) {
      return res.status(409).json({
        error: 'The clinic has not configured this patient profile.',
        code: 'profile_not_configured',
        supportId: supportId(req.deviceIdentity.patientId),
      });
    }
    const requiredBuild = profileMinimumBuild(patient.clinicalProfile);
    if (
      requiredBuild >= 8 &&
      (!supportsCanonicalDisorders(req) || mobileBuild(req) < requiredBuild)
    ) {
      return sendUpdateRequired(res, requiredBuild);
    }
    if (
      isIndependentClinicalProfile(patient.clinicalProfile) &&
      !supportsIndependentProfiles(req)
    ) {
      return sendUpdateRequired(res, 8);
    }
    return res.json({
      patientId: req.deviceIdentity.patientId,
      displayName: patient.displayName,
      supportId: supportId(req.deviceIdentity.patientId),
      clinicalProfile: patient.clinicalProfile,
    });
  },
);

app.post(
  '/api/symptom-entry',
  requireIncidentClear,
  requireDeviceIdentity,
  requireSupportedMobileBuild,
  (req,res)=>{
  const b=req.body||{}, wellness=b.wellnessPercent??b.wellness_score??b.wellness??'';
  const schemaVersion=payloadSchemaVersion(b);
  if (schemaVersion==null) {
    return res.status(400).json({
      error:'The submission schema version is invalid.',
      code:'invalid_schema_version',
    });
  }
  if (schemaVersion===2 && !supportsCanonicalDisorders(req)) {
    return sendUpdateRequired(res,8);
  }
  if (schemaVersion===3 && !supportsIndependentProfiles(req)) {
    return sendUpdateRequired(res,8);
  }
  const submissionId=typeof b.submissionId==='string'?b.submissionId.trim():'';
  const submittedPatientId=typeof b.patientId==='string'?b.patientId.trim():'';
  const patientId=String(
    req.deviceIdentity.effectivePatientId || req.deviceIdentity.patientId || '',
  ).trim();
  const rawPatientName=b.patientName??b.fullName;
  const submittedPatientName=typeof rawPatientName==='string'?rawPatientName.trim():'';
  const hasClinicProfile=Boolean(
    req.deviceIdentity.patient?.clinicalProfile,
  );
  const patientName=mobileBuild(req)>=7 || hasClinicProfile
    ? String(req.deviceIdentity.patient?.displayName||'').trim()
    : submittedPatientName;
  let profileRevision=Number(b.profileRevision||0);
  if (!validClinicalLabel(submissionId,160) ||
      !validClinicalLabel(submittedPatientId,120) ||
      !validClinicalLabel(patientName) ||
      !utcDateFromIso(b.date) || !looksLikeTime(b.time) ||
      !validSubmittedWellness(wellness)) {
    return res.status(400).json({error:'Invalid or incomplete submission.'});
  }
  if (req.deviceIdentity.patientId !== submittedPatientId) {
    return res.status(403).json({
      error: 'The submitted PatientId does not match this device enrolment.',
      code: 'patient_identity_mismatch',
    });
  }
  const rawRecords=Array.isArray(b.records)&&b.records.length?b.records:[
    {track:'Primary',disorder:b.disorder,symptom:b.symptom1,score:b.score1},
    {track:'Primary',disorder:b.disorder,symptom:b.symptom2,score:b.score2},
    {track:'Primary',disorder:b.disorder,symptom:b.symptom3,score:b.score3}
  ];
  const records=rawRecords.map(record=>({
    track:typeof record?.track==='string'?record.track.trim():'',
    disorderId:schemaVersion===2&&typeof record?.disorderId==='string'?record.disorderId.trim():'',
    disorder:typeof record?.disorder==='string'?record.disorder.trim():'',
    symptomId:schemaVersion>=2&&typeof record?.symptomId==='string'?record.symptomId.trim():'',
    symptom:typeof record?.symptom==='string'?record.symptom.trim():'',
    score:record?.score,
  }));
  if (schemaVersion === 3) {
    if (
      records.length < 1 ||
      records.length > maximumIndependentSymptoms ||
      records.some(record =>
        record.track !== 'Independent' ||
        record.disorderId ||
        record.disorder ||
        !validClinicalLabel(record.symptomId, 120) ||
        !validSubmittedScore(record.score)
      )
    ) {
      return res.status(400).json({
        error:`Between one and ${maximumIndependentSymptoms} valid independent symptom scores are required.`,
      });
    }
  } else {
    if (![3,6].includes(records.length) || records.some(r =>
      !['Primary','Second'].includes(r.track) ||
      (schemaVersion===1
        ? !validClinicalLabel(r.disorder,120) ||
          !validClinicalLabel(r.symptom,120)
        : !validClinicalLabel(r.disorderId,120) ||
          !validClinicalLabel(r.symptomId,120)) ||
      !validSubmittedScore(r.score)
    )) {
      return res.status(400).json({error:'Exactly three valid symptom scores per disorder are required.'});
    }
    const tracks=new Set(records.map(record=>record.track));
    if (!tracks.has('Primary') ||
        (records.length===3 && tracks.size!==1) ||
        (records.length===6 && (tracks.size!==2 || !tracks.has('Second')))) {
      return res.status(400).json({error:'Primary and second symptom tracks are invalid.'});
    }
    const disorderCounts=records.reduce((counts,r)=>{
      const key=`${r.track}|${r.disorderId||r.disorder}`;
      counts[key]=(counts[key]||0)+1;
      return counts;
    },{});
    if (Object.values(disorderCounts).some(count=>count!==3) || Object.keys(disorderCounts).length!==records.length/3) {
      return res.status(400).json({error:'Each tracked disorder must contain exactly three symptom scores.'});
    }
  }
  const duplicateSymptoms=records.some((record,index)=>records.some((other,otherIndex)=>
    otherIndex<index &&
    (schemaVersion === 3 || other.track===record.track) &&
    (other.disorderId||other.disorder)===(record.disorderId||record.disorder) &&
    (other.symptomId||other.symptom)===(record.symptomId||record.symptom)
  ));
  if (duplicateSymptoms) {
    return res.status(400).json({error:'Each tracked symptom must be unique.'});
  }
  let acceptedRecords=records;
  let assignedProfile=null;
  if (mobileBuild(req)>=7 || hasClinicProfile) {
    assignedProfile=Number.isInteger(profileRevision) &&
      profileRevision>=1
      ? identityStore.patientClinicalProfile(patientId,profileRevision)
      : identityStore.patientClinicalProfile(patientId);
    if (!assignedProfile) {
      return res.status(409).json({
        error:'The clinic-assigned profile is unavailable or out of date.',
        code:req.deviceIdentity.patient?.clinicalProfile
          ? 'profile_revision_unknown'
          : 'profile_not_configured',
      });
    }
    const requiredBuild=profileMinimumBuild(assignedProfile);
    if (
      requiredBuild>=8 &&
      (!supportsCanonicalDisorders(req)||mobileBuild(req)<requiredBuild)
    ) {
      return sendUpdateRequired(res,requiredBuild);
    }
    if (
      isIndependentClinicalProfile(assignedProfile) &&
      !supportsIndependentProfiles(req)
    ) {
      return sendUpdateRequired(res,8);
    }
    const canonicalRecords=canonicalRecordsForClinicalProfile(
      assignedProfile,
      records,
    );
    if (!canonicalRecords) {
      return res.status(409).json({
        error:'Submitted symptoms do not match the clinic-assigned profile.',
        code:'assigned_profile_mismatch',
      });
    }
    acceptedRecords=canonicalRecords;
    // Build 6 entries queued before a required Build 7 update have no profile
    // revision. They are accepted only when their records exactly match the
    // current clinic-assigned profile, then stamped with that revision.
    if (!Number.isInteger(profileRevision) || profileRevision<1) {
      profileRevision=Number(assignedProfile.revision);
    }
  }
  const existingRows=readRows();
  const submissionRows=existingRows.filter(row=>row.SubmissionId===submissionId);
  if (submissionRows.length) {
    const exactRetry=isExactSubmissionRetry(submissionRows,{
      patientId,
      date:b.date,
      time:b.time,
      wellness,
      profileRevision:profileRevision||'',
      records:acceptedRecords,
    });
    if (exactRetry) {
      recordAcceptedPayloadSchema(req,schemaVersion);
      return res.status(200).json({ok:true,duplicate:true,submissionId});
    }
    return res.status(409).json({
      error:'The submission identifier is already associated with another entry.',
      code:'submission_id_conflict',
    });
  }
  const dailySubmission=existingRows.find(row=>
    patientKey(row)===patientId && row.Date===b.date
  );
  if (dailySubmission) {
    return res.status(409).json({
      error:'A check-in has already been accepted for this patient and date.',
      code:'daily_submission_exists',
      date:b.date,
      existingSubmissionId:dailySubmission.SubmissionId||undefined,
    });
  }
  const receivedAt=new Date().toISOString();
  const profileDisorderIds=isIndependentClinicalProfile(assignedProfile)
    ? assignedProfile.disorderIds.join('|')
    : '';
  const profileDisorders=isIndependentClinicalProfile(assignedProfile)
    ? assignedProfile.disorders.join('|')
    : '';
  const lines=acceptedRecords.map(r=>{
    const row=normalisedRecord(
      receivedAt,
      b.date,
      b.time,
      patientName,
      r.track,
      r.disorder,
      r.symptom,
      r.score,
      wellness,
      submissionId,
      patientId,
      profileRevision||'',
      r.disorderId||'',
      r.symptomId||'',
      schemaVersion,
      profileDisorderIds,
      profileDisorders,
    );
    return csvColumns.map(column=>escapeCsv(row[column]||'')).join(',')+'\n';
  });
  fs.appendFileSync(csvPath,lines.join(''),'utf8');
  if (
    mobileBuild(req)<7 &&
    !req.deviceIdentity.patient?.clinicalProfile
  ) {
    identityStore.updatePatientDisplayName(patientId, patientName);
  }
  recordAcceptedPayloadSchema(req,schemaVersion);
  res.status(201).json({
    ok:true,
    duplicate:false,
    submissionId,
    rows:lines.length,
    payloadSchemaVersion:schemaVersion,
  });
});

function effectiveDevicePatientId(device) {
  return String(
    device?.recoveryTargetPatientId || device?.patientId || '',
  ).trim();
}

function enrolmentPatients(rows) {
  const directory = patientDirectory(rows);
  const store = identityStore.snapshot();
  const patientIds = new Set(Object.keys(store.patients));
  for (const patientId of directory.keys()) {
    if (!patientId.startsWith('legacy:')) patientIds.add(patientId);
  }
  return [...patientIds].map(patientId => {
    const fromData = directory.get(patientId);
    const fromStore = store.patients[patientId];
    if (fromStore?.reviewIdentity) return null;
    const activeDeviceRecords = Object.values(store.devices).filter(
      device => effectiveDevicePatientId(device) === patientId &&
        !device.revokedAt,
    );
    const observedBuilds = [...new Set(activeDeviceRecords.map(device =>
      Number.isInteger(device.lastMobileBuild)
        ? `Build ${device.lastMobileBuild}`
        : 'Build unknown'
    ))].sort().join(', ');
    return {
      patientId,
      displayName: fromStore?.displayName || fromData?.displayName || 'Unnamed patient',
      supportId: supportId(patientId),
      activeDevices: activeDeviceRecords.length,
      observedBuilds,
      quarantinedAt: fromStore?.quarantinedAt || null,
      quarantineReason: fromStore?.quarantineReason || null,
      identityCollision: fromStore?.identityCollision || null,
      recoveredFrom: fromStore?.recoveredFrom || null,
      clinicalProfile: fromStore?.clinicalProfile || null,
      suggestedProfile: fromStore?.clinicalProfile
        ? null
        : suggestedClinicalProfile(rows, patientId),
    };
  }).filter(Boolean).sort((a,b)=>a.displayName.localeCompare(b.displayName));
}

function suggestedClinicalProfile(rows, patientId) {
  const patientRows = rows
    .filter(row => patientKey(row) === patientId)
    .sort((left, right) =>
      String(right.ReceivedAt || '').localeCompare(String(left.ReceivedAt || ''))
    );
  if (!patientRows.length) return null;
  const latest = patientRows[0];
  const submissionRows = latest.SubmissionId
    ? patientRows.filter(row => row.SubmissionId === latest.SubmissionId)
    : patientRows.filter(row =>
        row.Date === latest.Date && row.Time === latest.Time
      );
  if (
    Number(latest.PayloadSchemaVersion) === 3 ||
    String(latest.ProfileDisorderIds || '').trim()
  ) {
    try {
      return normaliseClinicalProfile({
        schemaVersion: 3,
        disorderIds: splitProfileValues(latest.ProfileDisorderIds),
        disorders: splitProfileValues(latest.ProfileDisorders),
        symptomIds: submissionRows.map(row => row.SymptomId).filter(Boolean),
        symptoms: submissionRows.map(row => row.Symptom),
      }, {
        disorderCatalog,
        includeInactive: true,
        allowHistoricalSymptoms: true,
      });
    } catch (_) {
      return null;
    }
  }
  const primaryRows = submissionRows.filter(row => row.Track === 'Primary');
  const secondaryRows = submissionRows.filter(row => row.Track === 'Second');
  try {
    return normaliseClinicalProfile({
      primaryDisorderId: primaryRows[0]?.DisorderId,
      primaryDisorder: primaryRows[0]?.Disorder,
      primarySymptomIds: primaryRows.map(row => row.SymptomId).filter(Boolean),
      primarySymptoms: primaryRows.map(row => row.Symptom),
      secondaryDisorderId: secondaryRows[0]?.DisorderId || '',
      secondaryDisorder: secondaryRows[0]?.Disorder || '',
      secondarySymptomIds: secondaryRows.map(row => row.SymptomId).filter(Boolean),
      secondarySymptoms: secondaryRows.map(row => row.Symptom),
    }, {
      disorderCatalog,
      includeInactive: true,
      allowHistoricalSymptoms: true,
    });
  } catch (_) {
    return null;
  }
}

function profileDescription(profile) {
  if (!profile) return 'Not configured';
  if (isIndependentClinicalProfile(profile)) {
    return `${profile.disorders.join(', ')} · ${profile.symptoms.join(', ')}`;
  }
  const tracks = [
    `${profile.primaryDisorder}: ${profile.primarySymptoms.join(', ')}`,
  ];
  if (profile.secondaryDisorder) {
    tracks.push(
      `${profile.secondaryDisorder}: ${profile.secondarySymptoms.join(', ')}`,
    );
  }
  return tracks.join(' · ');
}

function availableDisorders(selectedIds = []) {
  const selected = new Set(selectedIds.filter(Boolean));
  const active = disorderCatalog.definitions();
  const visible = customDisordersEnabled
    ? active
    : active.filter(disorder => disorder.kind === 'built-in');
  for (const id of selected) {
    if (visible.some(disorder => disorder.id === id)) continue;
    const existing = disorderCatalog.findDisorder({
      id,
      includeInactive: true,
    });
    if (existing) visible.push(existing);
  }
  return visible;
}

function disorderOptions(selectedId = '', allowBlank = false) {
  return [
    allowBlank ? '<option value="">No second disorder</option>' : '',
    ...availableDisorders([selectedId]).map(disorder =>
      `<option value="${html(disorder.id)}" ${disorder.id === selectedId ? 'selected' : ''}>${html(disorder.displayName)}${disorder.active ? '' : ' (archived)'}</option>`
    ),
  ].join('');
}

function symptomSelectors(
  track,
  selectedDisorderIds = [],
  selectedSymptomIds = [],
) {
  const inputName = track === 'primary'
    ? 'primarySymptomIds'
    : 'secondarySymptomIds';
  return availableDisorders(selectedDisorderIds).map(disorder =>
    `<div class="patient-list symptom-group" data-track="${track}" data-disorder="${html(disorder.id)}">
      ${disorder.allowedSymptomIds.map((symptomId, index) =>
        `<label><input type="checkbox" name="${inputName}" value="${html(symptomId)}" ${selectedSymptomIds.includes(symptomId) ? 'checked' : ''}>${html(disorder.allowedSymptoms[index])}</label>`
      ).join('')}
    </div>`
  ).join('');
}

function legacyProfileEditor(patient = null) {
  const profile = patient?.clinicalProfile ||
    patient?.suggestedProfile || {
      primaryDisorder: 'Migraine',
      primaryDisorderId: 'migraine',
      primarySymptoms: [],
      primarySymptomIds: [],
      secondaryDisorder: null,
      secondaryDisorderId: null,
      secondarySymptoms: [],
      secondarySymptomIds: [],
    };
  const suggested = !patient?.clinicalProfile && patient?.suggestedProfile;
  const identityField = patient
    ? `<div class="field"><label>Clinic identity</label><div><strong>${html(patient.displayName)}</strong><br><span class="muted">${html(patient.supportId)} · The identity name is locked while editing its clinical profile.</span></div></div>
      <input type="hidden" name="displayName" value="${html(patient.displayName)}">`
    : '<div class="field"><label>Patient display name</label><input name="displayName" required maxlength="160" value=""></div>';
  const actions = patient
    ? `<button type="submit" name="action" value="save">Save profile changes</button>
        <a class="button secondary" href="/admin/enrolments">Cancel editing and create a new patient</a>`
    : `<button type="submit" name="action" value="save">Create patient without a code</button>
        <button type="submit" name="action" value="save-and-issue">Create patient and enrolment code</button>`;
  return `<section class="panel"><h2>${patient ? 'Edit existing clinic identity' : 'Create a new patient identity'}</h2>
    <p class="muted">Build 7 compatibility editor: clinic staff control the patient name, disorders, and exactly three symptoms per disorder. Saving retains the nested schema for this patient.</p>
    ${patient ? '<div class="notice"><strong>Edit mode:</strong> changes apply to this existing patient. Use “Cancel editing and create a new patient” for anybody else.</div>' : '<div class="notice"><strong>New-patient mode:</strong> submitting this form creates a distinct PatientId. After a code is issued, the form resets for the next patient.</div>'}
    ${suggested ? '<div class="notice"><strong>Suggested from the latest accepted check-in.</strong> Review all fields before saving.</div>' : ''}
    <form method="post" action="/admin/enrolments/save-profile" autocomplete="off" id="profileForm">
      <input type="hidden" name="csrfToken" value="${adminCsrfToken()}">
      <input type="hidden" name="patientId" value="${html(patient?.patientId || '')}">
      <input type="hidden" name="formMode" value="${patient ? 'edit' : 'create'}">
      <input type="hidden" name="profileModel" value="legacy-v1">
      ${identityField}
      <h3>Primary disorder</h3>
      <div class="field"><label>Disorder</label><select name="primaryDisorderId" id="primaryDisorder" required>${disorderOptions(profile.primaryDisorderId || 'migraine')}</select></div>
      <p class="muted"><span id="primaryCount">0</span>/3 symptoms selected</p>
      ${symptomSelectors('primary', [profile.primaryDisorderId], profile.primarySymptomIds || [])}
      <h3>Optional second disorder</h3>
      <div class="field"><label>Disorder</label><select name="secondaryDisorderId" id="secondaryDisorder">${disorderOptions(profile.secondaryDisorderId || '', true)}</select></div>
      <p class="muted"><span id="secondaryCount">0</span>/3 symptoms selected</p>
      ${symptomSelectors('secondary', [profile.secondaryDisorderId], profile.secondarySymptomIds || [])}
      <div class="toolbar" style="margin-top:18px">
        ${actions}
      </div>
    </form>
    <script>
      function updateTrack(track) {
        const select = document.getElementById(track + 'Disorder');
        const selected = select.value;
        const groups = [...document.querySelectorAll('[data-track="' + track + '"]')];
        groups.forEach(group => {
          const visible = group.dataset.disorder === selected;
          group.style.display = visible ? 'grid' : 'none';
          if (!visible) group.querySelectorAll('input').forEach(input => input.checked = false);
        });
        const active = groups.find(group => group.dataset.disorder === selected);
        const checked = active ? [...active.querySelectorAll('input:checked')] : [];
        document.getElementById(track + 'Count').textContent = checked.length;
      }
      ['primary', 'secondary'].forEach(track => {
        document.getElementById(track + 'Disorder').addEventListener('change', () => updateTrack(track));
        document.querySelectorAll('[data-track="' + track + '"] input').forEach(input => {
          input.addEventListener('change', event => {
            const group = event.target.closest('.symptom-group');
            const checked = [...group.querySelectorAll('input:checked')];
            if (checked.length > 3) event.target.checked = false;
            updateTrack(track);
          });
        });
        updateTrack(track);
      });
    </script>
  </section>`;
}

function independentProfileSelections(profile = null) {
  if (!profile) {
    return {
      disorderIds: ['migraine'],
      symptomIds: [],
    };
  }
  if (isIndependentClinicalProfile(profile)) {
    return {
      disorderIds: [...(profile.disorderIds || [])],
      symptomIds: [...(profile.symptomIds || [])],
    };
  }
  return {
    disorderIds: [
      profile.primaryDisorderId,
      profile.secondaryDisorderId,
    ].filter(Boolean),
    symptomIds: [...new Set([
      ...(profile.primarySymptomIds || []),
      ...(profile.secondarySymptomIds || []),
    ])],
  };
}

function availableSymptoms(selectedIds = []) {
  const selected = new Set(selectedIds.filter(Boolean));
  const active = disorderCatalog.symptomDefinitions();
  const visible = customDisordersEnabled
    ? active
    : active.filter(symptom => symptom.kind !== 'custom');
  for (const id of selected) {
    if (visible.some(symptom => symptom.id === id)) continue;
    const existing = disorderCatalog.findGlobalSymptom({ id });
    if (existing) visible.push(existing);
  }
  return visible.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'en-AU')
  );
}

function independentProfileEditor(patient = null) {
  const sourceProfile = patient?.clinicalProfile || patient?.suggestedProfile;
  const selected = independentProfileSelections(sourceProfile);
  const suggested = !patient?.clinicalProfile && patient?.suggestedProfile;
  const migrating = Boolean(
    patient?.clinicalProfile &&
    !isIndependentClinicalProfile(patient.clinicalProfile),
  );
  const disorderChoices = availableDisorders(selected.disorderIds);
  const symptomChoices = availableSymptoms(selected.symptomIds);
  const identityField = patient
    ? `<div class="field"><label>Clinic identity</label><div><strong>${html(patient.displayName)}</strong><br><span class="muted">${html(patient.supportId)} · The identity name is locked while editing its clinical profile.</span></div></div>
      <input type="hidden" name="displayName" value="${html(patient.displayName)}">`
    : '<div class="field"><label>Patient display name</label><input name="displayName" required maxlength="160" value=""></div>';
  const actions = patient
    ? `<button type="submit" name="action" value="save">Save profile changes</button>
        <a class="button secondary" href="/admin/enrolments">Cancel editing and create a new patient</a>`
    : `<button type="submit" name="action" value="save">Create patient without a code</button>
        <button type="submit" name="action" value="save-and-issue">Create patient and enrolment code</button>`;
  return `<section class="panel"><h2>${patient ? 'Edit existing clinic identity' : 'Create a new patient identity'}</h2>
    <p class="muted">Clinic staff independently select the patient’s disorders and between 1 and ${maximumIndependentSymptoms} symptoms. A symptom is rated once regardless of how many disorders are selected.</p>
    ${patient ? '<div class="notice"><strong>Edit mode:</strong> changes apply to this existing patient. Use “Cancel editing and create a new patient” for anybody else.</div>' : '<div class="notice"><strong>New-patient mode:</strong> submitting this form creates a distinct PatientId. After a code is issued, the form resets for the next patient.</div>'}
    ${suggested ? '<div class="notice"><strong>Suggested from the latest accepted check-in.</strong> Review all fields before saving.</div>' : ''}
    ${migrating ? '<div class="notice"><strong>Build 7 profile migration.</strong> Saving creates a new schema-3 profile revision. The previous nested revision and all historical check-ins remain unchanged.</div>' : ''}
    <form method="post" action="/admin/enrolments/save-profile" autocomplete="off" id="profileForm">
      <input type="hidden" name="csrfToken" value="${adminCsrfToken()}">
      <input type="hidden" name="patientId" value="${html(patient?.patientId || '')}">
      <input type="hidden" name="formMode" value="${patient ? 'edit' : 'create'}">
      <input type="hidden" name="schemaVersion" value="3">
      <input type="hidden" name="profileModel" value="independent-v1">
      ${identityField}
      <h3>Disorders</h3>
      <p class="muted">Select at least one. Disorders classify the patient; they do not constrain the symptom list.</p>
      <div class="patient-list" id="disorderChoices">
        ${disorderChoices.map(disorder => `<label><input type="checkbox" name="disorderIds" value="${html(disorder.id)}" ${selected.disorderIds.includes(disorder.id) ? 'checked' : ''}>${html(disorder.displayName)}${disorder.active ? '' : ' (archived)'}</label>`).join('')}
      </div>
      <h3>Symptoms</h3>
      <p class="muted"><span id="symptomCount">0</span>/${maximumIndependentSymptoms} selected · minimum 1</p>
      <div class="patient-list" id="symptomChoices">
        ${symptomChoices.map(symptom => `<label><input type="checkbox" name="symptomIds" value="${html(symptom.id)}" ${selected.symptomIds.includes(symptom.id) ? 'checked' : ''}>${html(symptom.displayName)}${symptom.active ? '' : ' (archived)'}</label>`).join('')}
      </div>
      <div class="toolbar" style="margin-top:18px">
        ${actions}
      </div>
    </form>
    <script>
      const symptomInputs = [...document.querySelectorAll('#symptomChoices input')];
      const disorderInputs = [...document.querySelectorAll('#disorderChoices input')];
      function updateIndependentCounts(event) {
        const checked = symptomInputs.filter(input => input.checked);
        if (checked.length > ${maximumIndependentSymptoms} && event) {
          event.target.checked = false;
        }
        document.getElementById('symptomCount').textContent =
          symptomInputs.filter(input => input.checked).length;
      }
      symptomInputs.forEach(input => input.addEventListener('change', updateIndependentCounts));
      updateIndependentCounts();
      document.getElementById('profileForm').addEventListener('submit', event => {
        const symptomCount = symptomInputs.filter(input => input.checked).length;
        const disorderCount = disorderInputs.filter(input => input.checked).length;
        if (disorderCount < 1 || symptomCount < 1 || symptomCount > ${maximumIndependentSymptoms}) {
          event.preventDefault();
          alert('Select at least one disorder and between 1 and ${maximumIndependentSymptoms} symptoms.');
        }
      });
    </script>
  </section>`;
}

function profileEditor(patient = null, requestedMode = '') {
  if (!independentProfilesEnabled) return legacyProfileEditor(patient);
  const canMaintainLegacy = Boolean(
    patient?.clinicalProfile &&
    !isIndependentClinicalProfile(patient.clinicalProfile),
  );
  return requestedMode === 'legacy' && canMaintainLegacy
    ? legacyProfileEditor(patient)
    : independentProfileEditor(patient);
}

function enrolmentPage({
  issued = null,
  error = '',
  message = '',
  editPatientId = '',
  profileMode = '',
} = {}) {
  const patients = enrolmentPatients(readRows());
  const csrfToken = adminCsrfToken();
  const editPatient = patients.find(
    patient => patient.patientId === editPatientId && !patient.quarantinedAt,
  ) || null;
  const notice = issued ? `<div class="notice">
    <strong>One-time enrolment code for ${html(issued.displayName)}</strong>
    <div class="code">${html(issued.code)}</div>
    <div>Support ID: ${html(issued.supportId)} · Expires: ${html(new Date(issued.expiresAt).toLocaleString('en-AU'))}</div>
    <div><strong>Enrolment link:</strong> <a href="${html(`${publicBaseUrl}/enrol#${normaliseCode(issued.code)}`)}">${html(`${publicBaseUrl}/enrol#${normaliseCode(issued.code)}`)}</a></div>
    <p><strong>Copy the link or code now.</strong> The code is not stored in readable form and cannot be shown again.</p>
    <p><strong>A blank new-patient form is shown below.</strong> The issued identity is complete; do not edit it to enrol somebody else.</p>
  </div>` : '';
  const errorNotice = error ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>` : '';
  const messageNotice = message ? `<div class="notice" style="border-color:#047857;background:#ecfdf5"><strong>${html(message)}</strong></div>` : '';
  const patientRows = patients.map(patient => {
    const status = patient.quarantinedAt
      ? '<strong class="flag">QUARANTINED IDENTITY COLLISION</strong>'
      : patient.recoveredFrom
      ? '<strong class="good">Recovered separate identity</strong>'
      : patient.identityCollision?.quarantineReleasedAt
      ? '<strong class="good">Restored disentangled identity</strong>'
      : '';
    const actions = patient.quarantinedAt
      ? '<a class="button danger" style="width:auto;padding:7px 10px" href="/admin/enrolments/recovery">Continue identity recovery</a>'
      : `<a class="button secondary" style="width:auto;padding:7px 10px" href="/admin/enrolments?editPatientId=${encodeURIComponent(patient.patientId)}">Edit profile</a>
        ${independentProfilesEnabled && patient.clinicalProfile && !isIndependentClinicalProfile(patient.clinicalProfile) ? `<a class="button secondary" style="width:auto;padding:7px 10px" href="/admin/enrolments?editPatientId=${encodeURIComponent(patient.patientId)}&profileMode=legacy">Maintain Build 7 profile</a>` : ''}
        ${patient.clinicalProfile ? `<form class="inline-form" method="post" action="/admin/enrolments/issue">
          <input type="hidden" name="csrfToken" value="${csrfToken}">
          <input type="hidden" name="patientId" value="${html(patient.patientId)}">
          <button type="submit">New device code</button>
        </form>` : '<strong class="flag">Profile required</strong>'}
        <form class="inline-form" method="post" action="/admin/enrolments/revoke" onsubmit="return confirm('Revoke every enrolled device for this patient?')">
          <input type="hidden" name="csrfToken" value="${csrfToken}">
          <input type="hidden" name="patientId" value="${html(patient.patientId)}">
          <button class="danger" type="submit">Revoke devices</button>
        </form>`;
    return `<tr>
    <td>${html(patient.displayName)}</td>
    <td>${html(patient.supportId)}</td>
    <td>${status}${status ? '<br>' : ''}${html(profileDescription(patient.clinicalProfile))}</td>
    <td>${patient.activeDevices}${patient.observedBuilds ? `<br><span class="muted">${html(patient.observedBuilds)}</span>` : ''}</td>
    <td>${actions}</td>
  </tr>`;
  }).join('');
  const body = `${notice}${errorNotice}${messageNotice}${profileEditor(editPatient, profileMode)}
  <section class="panel"><h2>Existing clinic identities</h2>
    <p class="muted">Profile changes synchronise to enrolled phones. Use “New device code” after a reinstall or phone change so the PatientId remains stable.</p>
    <div class="table-wrap"><table><thead><tr><th>Clinic name</th><th>Support ID</th><th>Assigned profile</th><th>Active devices / observed builds</th><th>Actions</th></tr></thead>
    <tbody>${patientRows || '<tr><td colspan="5">No patient identities yet.</td></tr>'}</tbody></table></div>
  </section>`;
  return pageShell('Clinic enrolments', body);
}

function enrolmentRecoveryPage({ error = '', recovered = null } = {}) {
  const snapshot = identityStore.snapshot();
  const originalCodes = Object.values(snapshot.enrolmentCodes)
    .filter(record => !record.incidentRecovery);
  const affectedRows = Object.values(snapshot.patients)
    .filter(patient => patient && !patient.reviewIdentity)
    .map(patient => {
      const records = originalCodes.filter(
        record => record.patientId === patient.patientId,
      );
      const activeDevices = Object.values(snapshot.devices).filter(
        device => effectiveDevicePatientId(device) === patient.patientId &&
          !device.revokedAt,
      ).length;
      const recoveredCodes = records.filter(record => record.recoveredAt).length;
      return {
        patient,
        records,
        activeDevices,
        recoveredCodes,
      };
    })
    .filter(item => item.records.length > 1 || item.patient.quarantinedAt)
    .sort((left, right) =>
      String(left.patient.displayName || '').localeCompare(
        String(right.patient.displayName || ''),
        'en-AU',
      )
    );
  const candidateRows = affectedRows.map(item => `<tr>
    <td>${html(item.patient.displayName || 'Unnamed patient')}</td>
    <td>${html(supportId(item.patient.patientId))}</td>
    <td>${item.records.length}</td>
    <td>${item.recoveredCodes}</td>
    <td>${item.activeDevices}</td>
    <td>${item.patient.quarantinedAt ? '<strong class="flag">Quarantined</strong>' : '<strong class="flag">Collision suspected</strong>'}</td>
  </tr>`).join('');
  const errorNotice = error
    ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>`
    : '';
  const recoveryNotice = recovered ? `<div class="notice" style="border-color:#047857;background:#ecfdf5">
    <strong>Separate identity recovered for ${html(recovered.displayName)}</strong>
    <div class="code">${html(recovered.code)}</div>
    <div>New Support ID: ${html(recovered.supportId)} · Expires: ${html(new Date(recovered.expiresAt).toLocaleString('en-AU'))}</div>
    <div><strong>Replacement enrolment link:</strong> <a href="${html(`${publicBaseUrl}/enrol#${normaliseCode(recovered.code)}`)}">${html(`${publicBaseUrl}/enrol#${normaliseCode(recovered.code)}`)}</a></div>
    <p>Recovered profile: ${html(profileDescription(recovered.clinicalProfile))}</p>
    <p>Original code status: <strong>${recovered.originalCodeWasUsed ? 'previously used on a phone' : 'not yet used'}</strong>. ${recovered.bridgedDevices ? 'Its installed device was matched to the original redemption and safely bridged to this recovered identity.' : recovered.bridgeAmbiguous ? 'More than one device matched the redemption time, so no automatic bridge was made; contact support before relying on unsent phone entries.' : 'No active installed device needed a recovery bridge.'} ${recovered.revokedDevices ? `${recovered.revokedDevices} unmatched device credential(s) were revoked.` : ''}</p>
    <p><strong>Copy this replacement code now.</strong> It cannot be displayed again. For an already-installed phone, first reopen the app after mobile access is restored and let any pending check-ins sync. Only when Settings shows “Synced” should the patient use Settings → Clinic enrolment → Enter a new enrolment code. Entering the replacement code retires the temporary bridge.</p>
    <p class="muted">Recovery backup: ${html(path.basename(recovered.backupPath))}</p>
  </div>` : '';
  const csrfToken = adminCsrfToken();
  const lockdownNotice = enrolmentIncidentLockdown
    ? '<div class="notice" style="border-color:#047857;background:#ecfdf5"><strong>Mobile containment is active.</strong> It is safe to recover identities while enrolment, profile sync, and symptom uploads remain paused.</div>'
    : '<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>Recovery is blocked until mobile containment is active.</strong> Set <code>ENROLMENT_INCIDENT_LOCKDOWN=true</code> and restart the backend before recovering any code.</div>';
  return pageShell('Identity recovery', `${recoveryNotice}${errorNotice}${lockdownNotice}
    <section class="panel">
      <h2>Recover one patient from the shared identity</h2>
      <p>Use the <strong>original code sent to that patient</strong>. The server uses its issue-time profile revision to create a distinct PatientId and replacement code.</p>
      <p class="flag">The first successful recovery quarantines the collided identity and invalidates all its original codes, immediately blocking the shared record. When a used code has one exact device match, that device is bridged only to its recovered identity so pending entries can sync safely after lockdown. Unmatched devices remain blocked and are revoked when recovery is complete. Existing mixed submissions are retained under the quarantined identity and are not reassigned automatically.</p>
      <form method="post" action="/admin/enrolments/recover-collision" autocomplete="off" class="toolbar">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <div class="field"><label>Correct patient display name</label><input name="displayName" required maxlength="160"></div>
        <div class="field"><label>Original enrolment code</label><input name="originalCode" required maxlength="20" placeholder="XXXX-XXXX-XXXX"></div>
        <div class="field"><label>Type RECOVER to confirm</label><input name="confirmation" required autocomplete="off"></div>
        <div class="field"><label>&nbsp;</label><button class="danger" type="submit">Recover separate identity</button></div>
      </form>
    </section>
    <section class="panel"><h2>Collision status</h2>
      <div class="table-wrap"><table><thead><tr><th>Current stored name</th><th>Shared Support ID</th><th>Original codes</th><th>Recovered</th><th>Active devices</th><th>Status</th></tr></thead>
      <tbody>${candidateRows || '<tr><td colspan="6">No multi-code identity was detected.</td></tr>'}</tbody></table></div>
    </section>`);
}

function disorderManagementPage({ error = '', message = '' } = {}) {
  const csrfToken = adminCsrfToken();
  const definitions = disorderCatalog.definitions({ includeInactive: true });
  const compatibility = identityStore.compatibilitySummary();
  const buildTraffic = Object.entries(compatibility.builds)
    .sort(([left], [right]) => left.localeCompare(right, 'en-AU', {
      numeric: true,
    }))
    .map(([build, count]) =>
      `${build === 'unknown' ? 'Unknown build' : `Build ${build}`}: ${count}`
    ).join(' · ') || 'No active devices observed';
  const schemaTraffic = Object.entries(compatibility.payloadSchemas)
    .sort(([left], [right]) => left.localeCompare(right, 'en-AU', {
      numeric: true,
    }))
    .map(([schema, count]) =>
      `${schema === 'unknown' ? 'No submission observed' : `Schema ${schema}`}: ${count}`
    ).join(' · ');
  const errorNotice = error
    ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>`
    : '';
  const messageNotice = message
    ? `<div class="notice" style="border-color:#047857;background:#ecfdf5"><strong>${html(message)}</strong></div>`
    : '';
  const rows = definitions.map(disorder => {
    const status = disorder.kind === 'built-in'
      ? 'Built in'
      : disorder.active
      ? 'Active'
      : 'Archived';
    const identityActions = disorder.kind === 'built-in'
      ? '<span class="muted">Name protected</span>'
      : `<details><summary>Edit or archive name</summary>
          <form method="post" action="/admin/disorders/update" autocomplete="off" style="min-width:320px;margin-top:10px">
            <input type="hidden" name="csrfToken" value="${csrfToken}">
            <input type="hidden" name="disorderId" value="${html(disorder.id)}">
            <div class="field"><label>Correct display name</label><input name="displayName" required maxlength="120" value="${html(disorder.displayName)}"></div>
            <div class="field"><label>Retype display name</label><input name="confirmation" required maxlength="120"></div>
            <button type="submit" name="action" value="rename">Save corrected name</button>
          </form>
          <form class="inline-form" method="post" action="/admin/disorders/update" style="display:block;margin-top:10px" onsubmit="return confirm('${disorder.active ? 'Archive this disorder for future profile assignments?' : 'Reactivate this disorder?'}')">
            <input type="hidden" name="csrfToken" value="${csrfToken}">
            <input type="hidden" name="disorderId" value="${html(disorder.id)}">
            <button class="${disorder.active ? 'danger' : 'secondary'}" type="submit" name="action" value="${disorder.active ? 'archive' : 'reactivate'}">${disorder.active ? 'Archive' : 'Reactivate'}</button>
          </form>
        </details>`;
    return `<tr>
      <td>${html(disorder.displayName)}</td>
      <td><code>${html(disorder.id)}</code></td>
      <td>${status}</td>
      <td>Build ${disorder.minimumAppBuild}+</td>
      <td>${identityActions}</td>
    </tr>`;
  }).join('');
  const activation = customDisordersEnabled
    ? '<strong class="good">Build 8-only disorder and symptom assignment is enabled.</strong>'
    : '<strong class="flag">Build 8-only disorder and symptom assignment remains disabled until Build 8 is available on both stores.</strong>';
  const body = `${errorNotice}${messageNotice}
    <section class="panel"><h2>Compatibility traffic</h2>
      <p><strong>${html(buildTraffic)}</strong></p>
      <p class="muted">${html(schemaTraffic)}${schemaTraffic ? ' · ' : ''}Canonical-capable active devices: ${compatibility.canonicalDevices}/${compatibility.activeDevices}.</p>
      <p class="muted">Build 7 and schema 1 remain supported. These observations are evidence for a later compatibility review; they do not automatically retire older handling.</p>
    </section>
    <section class="panel"><h2>Disorder catalogue</h2>
      <p>${activation}</p>
      <p class="muted">Disorders are maintained independently from symptoms. Build 7 profile revisions retain their historical nested mappings, but Build 8 profiles select disorders and symptoms from separate controlled lists.</p>
      <div class="table-wrap"><table><thead><tr><th>Display name</th><th>Canonical ID</th><th>Status</th><th>Mobile support</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <section class="panel"><h2>Create a custom disorder</h2>
      <p class="muted">Use the clinically correct name and retype it independently. Case and spacing variants of existing disorders are rejected.</p>
      <form method="post" action="/admin/disorders/create" autocomplete="off">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <div class="toolbar">
          <div class="field"><label>Exact disorder name</label><input name="displayName" required minlength="3" maxlength="120"></div>
          <div class="field"><label>Retype exact disorder name</label><input name="confirmation" required minlength="3" maxlength="120"></div>
          <div class="field"><label>&nbsp;</label><button type="submit">Create catalogue entry</button></div>
        </div>
      </form>
    </section>`;
  return pageShell('Disorders', body);
}

function symptomManagementPage({ error = '', message = '' } = {}) {
  const csrfToken = adminCsrfToken();
  const symptoms = disorderCatalog.symptomDefinitions({
    includeInactive: true,
  });
  const errorNotice = error
    ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>`
    : '';
  const messageNotice = message
    ? `<div class="notice" style="border-color:#047857;background:#ecfdf5"><strong>${html(message)}</strong></div>`
    : '';
  const rows = symptoms.map(symptom => {
    const status = symptom.kind === 'built-in'
      ? 'Built in'
      : symptom.active
      ? 'Active custom'
      : 'Archived custom';
    const actions = symptom.kind === 'custom'
      ? `<details><summary>Edit or archive</summary>
          <form method="post" action="/admin/disorders/update-symptom" autocomplete="off" style="min-width:320px;margin-top:10px">
            <input type="hidden" name="csrfToken" value="${csrfToken}">
            <input type="hidden" name="symptomId" value="${html(symptom.id)}">
            <div class="field"><label>Correct symptom name</label><input name="displayName" required maxlength="80" value="${html(symptom.displayName)}"></div>
            <div class="field"><label>Retype symptom name</label><input name="confirmation" required maxlength="80"></div>
            <button type="submit" name="action" value="rename">Save corrected name</button>
          </form>
          <form class="inline-form" method="post" action="/admin/disorders/update-symptom" style="display:block;margin-top:10px" onsubmit="return confirm('${symptom.active ? 'Archive this symptom for future profile assignments?' : 'Reactivate this symptom?'}')">
            <input type="hidden" name="csrfToken" value="${csrfToken}">
            <input type="hidden" name="symptomId" value="${html(symptom.id)}">
            <button class="${symptom.active ? 'danger' : 'secondary'}" type="submit" name="action" value="${symptom.active ? 'archive' : 'reactivate'}">${symptom.active ? 'Archive' : 'Reactivate'}</button>
          </form>
        </details>`
      : '<span class="muted">Stable built-in definition</span>';
    return `<tr>
      <td>${html(symptom.displayName)}</td>
      <td><code>${html(symptom.id)}</code></td>
      <td>${status}</td>
      <td>Build ${symptom.minimumAppBuild}+</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  const activation = independentProfilesEnabled
    ? `<strong class="good">Independent profiles are enabled. Staff may assign between 1 and ${maximumIndependentSymptoms} symptoms.</strong>`
    : '<strong class="flag">Independent profiles remain disabled during the backend-first Build 8 rollout.</strong>';
  const body = `${errorNotice}${messageNotice}
    <section class="panel"><h2>Symptom catalogue</h2>
      <p>${activation}</p>
      <p class="muted">Symptoms are independent clinical definitions and are not nested beneath disorders. A readable canonical ID is created from the original approved name and remains fixed after later display-name corrections. Archiving prevents future assignment without deleting historical references.</p>
      <div class="table-wrap"><table><thead><tr><th>Display name</th><th>Canonical ID (fixed)</th><th>Status</th><th>Mobile support</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <section class="panel"><h2>Create a custom symptom</h2>
      <p class="muted">Use the clinically correct name and enter it twice. Case, spacing and punctuation variants of existing symptoms are rejected.</p>
      <form method="post" action="/admin/disorders/create-symptom" autocomplete="off">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <div class="toolbar">
          <div class="field"><label>Exact symptom name</label><input name="displayName" required minlength="2" maxlength="80"></div>
          <div class="field"><label>Retype exact symptom name</label><input name="confirmation" required minlength="2" maxlength="80"></div>
          <div class="field"><label>&nbsp;</label><button type="submit">Create symptom</button></div>
        </div>
      </form>
    </section>`;
  return pageShell('Symptoms', body);
}

app.get('/admin/disorders',requirePortalUser,requirePermission('disorders_symptoms'),(req,res)=>{
  res.send(disorderManagementPage());
});

app.get('/admin/symptoms',requirePortalUser,requirePermission('disorders_symptoms'),(req,res)=>{
  res.send(symptomManagementPage());
});

app.post('/admin/disorders/create',requirePortalUser,requirePermission('disorders_symptoms'),requireAdminCsrf,(req,res)=>{
  try {
    const created = disorderCatalog.createCustomDisorder({
      displayName: req.body.displayName,
      confirmation: req.body.confirmation,
      actor: adminUser,
    });
    return res.status(201).send(disorderManagementPage({
      message: `${created.displayName} was created with canonical ID ${created.id}.`,
    }));
  } catch (error) {
    return res.status(400).send(disorderManagementPage({
      error: error.message,
    }));
  }
});

app.post('/admin/disorders/update',requirePortalUser,requirePermission('disorders_symptoms'),requireAdminCsrf,(req,res)=>{
  try {
    const action = String(req.body.action || '');
    const input = {
      id: req.body.disorderId,
      actor: adminUser,
    };
    if (action === 'rename') {
      input.displayName = req.body.displayName;
      input.confirmation = req.body.confirmation;
    } else if (action === 'archive') {
      input.active = false;
    } else if (action === 'reactivate') {
      input.active = true;
    } else {
      throw new Error('The requested catalogue action is invalid.');
    }
    const updated = disorderCatalog.updateCustomDisorder(input);
    const refreshedProfiles = action === 'rename'
      ? identityStore.refreshProfilesForDisorder(updated.id)
      : 0;
    return res.send(disorderManagementPage({
      message: `${updated.displayName} was updated.${refreshedProfiles ? ` ${refreshedProfiles} assigned profile(s) received a new revision.` : ''}`,
    }));
  } catch (error) {
    return res.status(400).send(disorderManagementPage({
      error: error.message,
    }));
  }
});

app.post('/admin/disorders/create-symptom',requirePortalUser,requirePermission('disorders_symptoms'),requireAdminCsrf,(req,res)=>{
  try {
    const created = disorderCatalog.createCustomSymptom({
      displayName: req.body.displayName,
      confirmation: req.body.confirmation,
      actor: adminUser,
    });
    return res.status(201).send(symptomManagementPage({
      message: `${created.displayName} was created with canonical ID ${created.id}.`,
    }));
  } catch (error) {
    return res.status(400).send(symptomManagementPage({
      error: error.message,
    }));
  }
});

app.post('/admin/disorders/update-symptom',requirePortalUser,requirePermission('disorders_symptoms'),requireAdminCsrf,(req,res)=>{
  try {
    const action = String(req.body.action || '');
    const input = {
      id: req.body.symptomId,
      actor: adminUser,
    };
    if (action === 'rename') {
      input.displayName = req.body.displayName;
      input.confirmation = req.body.confirmation;
    } else if (action === 'archive') {
      input.active = false;
    } else if (action === 'reactivate') {
      input.active = true;
    } else {
      throw new Error('The requested symptom action is invalid.');
    }
    const updated = disorderCatalog.updateCustomSymptom(input);
    const refreshedProfiles = action === 'rename'
      ? identityStore.refreshProfilesForSymptom(updated.id)
      : 0;
    return res.send(symptomManagementPage({
      message: `${updated.displayName} was updated.${refreshedProfiles ? ` ${refreshedProfiles} assigned profile(s) received a new revision.` : ''}`,
    }));
  } catch (error) {
    return res.status(400).send(symptomManagementPage({
      error: error.message,
    }));
  }
});

app.post('/admin/disorders/set-symptoms',requirePortalUser,requirePermission('disorders_symptoms'),requireAdminCsrf,(req,res)=>{
  try {
    const updated = disorderCatalog.setDisorderSymptoms({
      disorderId: req.body.disorderId,
      symptomIds: values(req.body.symptomIds),
      actor: adminUser,
    });
    return res.send(disorderManagementPage({
      message: `${updated.displayName} now offers ${updated.allowedSymptoms.length} symptoms for future profile assignments. Existing assigned revisions were preserved.`,
    }));
  } catch (error) {
    return res.status(400).send(disorderManagementPage({
      error: error.message,
    }));
  }
});

app.get('/admin/export.csv',requirePortalUser,requirePermission('csv_export'),(req,res)=>res.download(csvPath,'neurosol_symptom_entries.csv'));

app.get('/admin/enrolments',requirePortalUser,requirePermission('enrolments'),(req,res)=>{
  res.send(enrolmentPage({
    editPatientId: String(req.query.editPatientId || '').trim(),
    profileMode: String(req.query.profileMode || '').trim(),
  }));
});

app.get('/admin/enrolments/recovery',requirePortalUser,requirePermission('identity_recovery'),(req,res)=>{
  res.send(enrolmentRecoveryPage());
});

app.post(
  '/admin/enrolments/recover-collision',
  requirePortalUser,
  requirePermission('identity_recovery'),
  requireAdminCsrf,
  (req,res)=>{
    if (!enrolmentIncidentLockdown) {
      return res.status(409).send(enrolmentRecoveryPage({
        error: 'Enable ENROLMENT_INCIDENT_LOCKDOWN before recovering an identity.',
      }));
    }
    if (String(req.body.confirmation || '').trim().toUpperCase() !== 'RECOVER') {
      return res.status(400).send(enrolmentRecoveryPage({
        error: 'Type RECOVER exactly to confirm identity recovery.',
      }));
    }
    try {
      const recovered = identityStore.recoverCollidedEnrolment({
        originalCode: req.body.originalCode,
        displayName: req.body.displayName,
        expiresInDays: 14,
      });
      return res.status(201).send(enrolmentRecoveryPage({ recovered }));
    } catch (error) {
      return res.status(400).send(enrolmentRecoveryPage({
        error: error.message,
      }));
    }
  },
);

app.post('/admin/enrolments/save-profile',requirePortalUser,requirePermission('enrolments'),requireAdminCsrf,(req,res)=>{
  const requestedIndependent =
    String(req.body.profileModel || '') === 'independent-v1' ||
    Number(req.body.schemaVersion) === 3;
  try {
    const patientId = String(req.body.patientId || '').trim();
    const formMode = String(req.body.formMode || '').trim();
    const existingPatient = patientId
      ? identityStore.snapshot().patients[patientId]
      : null;
    if (!['create', 'edit'].includes(formMode)) {
      throw new Error(
        'This enrolment form is stale. Reload the enrolments page before saving.',
      );
    }
    if (formMode === 'create' && patientId) {
      throw new Error(
        'A new-patient form cannot contain an existing PatientId. Reload the enrolments page.',
      );
    }
    if (formMode === 'edit' && (!patientId || !existingPatient)) {
      throw new Error(
        'The clinic identity being edited was not found. Reload the enrolments page.',
      );
    }
    if (formMode === 'edit' && req.body.action === 'save-and-issue') {
      throw new Error(
        'An edit form cannot create a new-patient enrolment. Save the profile, then use New device code for this same patient.',
      );
    }
    if (requestedIndependent && !independentProfilesEnabled) {
      throw new Error(
        'Independent Build 8 profiles are not enabled in production yet.',
      );
    }
    if (
      independentProfilesEnabled &&
      !requestedIndependent &&
      (!existingPatient?.clinicalProfile ||
        isIndependentClinicalProfile(existingPatient.clinicalProfile))
    ) {
      throw new Error(
        'New Build 8 profiles must use independent disorder and symptom lists.',
      );
    }
    const clinicalProfile = normaliseClinicalProfile(
      requestedIndependent
        ? {
            schemaVersion: 3,
            disorderIds: values(req.body.disorderIds),
            symptomIds: values(req.body.symptomIds),
          }
        : {
            primaryDisorderId: req.body.primaryDisorderId,
            primarySymptomIds: values(req.body.primarySymptomIds),
            secondaryDisorderId: req.body.secondaryDisorderId,
            secondarySymptomIds: values(req.body.secondarySymptomIds),
            // Build 7 form compatibility during the backend-first rollout.
            primaryDisorder: req.body.primaryDisorder,
            primarySymptoms: values(req.body.primarySymptoms),
            secondaryDisorder: req.body.secondaryDisorder,
            secondarySymptoms: values(req.body.secondarySymptoms),
          },
      { disorderCatalog },
    );
    const assignedDisorderIds = isIndependentClinicalProfile(clinicalProfile)
      ? clinicalProfile.disorderIds
      : [
          clinicalProfile.primaryDisorderId,
          clinicalProfile.secondaryDisorderId,
        ].filter(Boolean);
    const assignedSymptomIds = isIndependentClinicalProfile(clinicalProfile)
      ? clinicalProfile.symptomIds
      : [
          ...clinicalProfile.primarySymptomIds,
          ...clinicalProfile.secondarySymptomIds,
        ];
    const includesCustomContent =
      assignedDisorderIds.some(id =>
        disorderCatalog.findDisorder({ id, includeInactive: true })?.kind ===
          'custom'
      ) ||
      assignedSymptomIds.some(id =>
        disorderCatalog.findGlobalSymptom({ id })?.kind === 'custom'
      );
    if (includesCustomContent && !customDisordersEnabled) {
      throw new Error(
        'Build 8-only disorder or symptom assignment is disabled until Build 8 is available.',
      );
    }
    if (profileMinimumBuild(clinicalProfile) >= 8 && patientId) {
      const activeDevices = Object.values(identityStore.snapshot().devices)
        .filter(device =>
          effectiveDevicePatientId(device) === patientId && !device.revokedAt
        );
      const incompatibleDevices = activeDevices.filter(device =>
        !Number.isInteger(device.lastMobileBuild) ||
        device.lastMobileBuild < 8 ||
        device.supportsCanonicalDisorders !== true ||
        (isIndependentClinicalProfile(clinicalProfile) &&
          device.supportsIndependentProfiles !== true)
      );
      if (incompatibleDevices.length) {
        throw new Error(
          'This patient still has an active Build 7 or unconfirmed device. ' +
          'Observe the device on Build 8 with canonical support, or revoke ' +
          'the obsolete device, before assigning Build 8-only profile content.',
        );
      }
    }
    const saved = identityStore.saveClinicalProfile({
      patientId,
      displayName: formMode === 'edit'
        ? existingPatient.displayName
        : String(req.body.displayName || '').trim(),
      clinicalProfile,
    });
    if (req.body.action === 'save-and-issue') {
      const issued = identityStore.issueEnrolmentCode({
        patientId: saved.patientId,
        displayName: saved.displayName,
        requireClinicalProfile: true,
      });
      return res.status(201).send(enrolmentPage({
        issued,
        editPatientId: '',
        profileMode: '',
      }));
    }
    return res.send(enrolmentPage({
      message: `Profile saved for ${saved.displayName}. Enrolled phones will receive revision ${saved.clinicalProfile.revision}.`,
      editPatientId: saved.patientId,
      profileMode: requestedIndependent ? '' : 'legacy',
    }));
  } catch (error) {
    return res.status(400).send(enrolmentPage({
      error: error.message,
      editPatientId: String(req.body.formMode || '').trim() === 'edit'
        ? String(req.body.patientId || '').trim()
        : '',
      profileMode: requestedIndependent ? '' : 'legacy',
    }));
  }
});

app.post('/admin/enrolments/issue',requirePortalUser,requirePermission('enrolments'),requireAdminCsrf,(req,res)=>{
  try {
    const patientId = String(req.body.patientId || '').trim();
    const patient = identityStore.snapshot().patients[patientId];
    if (!patient) throw new Error('The patient identity was not found.');
    const issued = identityStore.issueEnrolmentCode({
      patientId,
      displayName: patient.displayName,
      requireClinicalProfile: true,
      replacesPatientId: patient.recoveredFrom?.patientId || '',
    });
    res.status(201).send(enrolmentPage({ issued, editPatientId: patientId }));
  } catch (error) {
    res.status(400).send(enrolmentPage({ error: error.message }));
  }
});

app.post('/admin/enrolments/revoke',requirePortalUser,requirePermission('enrolments'),requireAdminCsrf,(req,res)=>{
  const patientId = String(req.body.patientId || '').trim();
  const revoked = identityStore.revokePatientDevices(patientId);
  res.send(enrolmentPage({
    error: revoked
      ? `${revoked} device enrolment(s) were revoked.`
      : 'No active devices were found for that patient.',
  }));
});

function patientManagementPage({ error = '', message = '' } = {}) {
  const rows = readRows();
  const patients = enrolmentPatients(rows);
  const csrfToken = adminCsrfToken();
  const tableRows = patients.map(patient => {
    const patientRows = rows.filter(row => patientKey(row) === patient.patientId);
    const submissions = new Set(patientRows.map(row =>
      row.SubmissionId || `${row.Date}|${row.Time}`
    )).size;
    const deletion = patient.quarantinedAt
      ? '<strong class="flag">Preserved incident record — deletion disabled</strong>'
      : `<form method="post" action="/admin/patients/delete" class="toolbar" onsubmit="return confirm('Permanently remove this patient from the portal and revoke every device? A server backup will be retained.')">
          <input type="hidden" name="csrfToken" value="${csrfToken}">
          <input type="hidden" name="patientId" value="${html(patient.patientId)}">
          <div class="field"><label>Type ${html(patient.supportId)} to confirm</label><input name="confirmation" required autocomplete="off"></div>
          <div class="field"><label>&nbsp;</label><button class="danger" type="submit">Delete patient</button></div>
        </form>`;
    return `<tr>
      <td>${html(patient.displayName)}</td>
      <td>${html(patient.supportId)}</td>
      <td>${submissions}</td>
      <td>${deletion}</td>
    </tr>`;
  }).join('');
  const errorNotice = error
    ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>`
    : '';
  const messageNotice = message
    ? `<div class="notice" style="border-color:#047857;background:#ecfdf5"><strong>${html(message)}</strong></div>`
    : '';
  return pageShell('Manage patients', `${errorNotice}${messageNotice}
    <section class="panel"><h2>Delete a patient record</h2>
      <p class="flag">Deletion removes the patient’s portal identity, device access, unused enrolment codes, and submitted rows. It cannot be undone through the portal.</p>
      <p class="muted">A timestamped server backup is created first. Records imported without a PatientId are deliberately excluded from this screen.</p>
      <div class="table-wrap"><table><thead><tr><th>Clinic name</th><th>Support ID</th><th>Check-ins</th><th>Confirmation</th></tr></thead>
      <tbody>${tableRows || '<tr><td colspan="4">No identified patients found.</td></tr>'}</tbody></table></div>
    </section>`);
}

app.get('/admin/patients',requirePortalUser,requirePermission('manage_patients'),(req,res)=>{
  res.send(patientManagementPage());
});

app.post('/admin/patients/delete',requirePortalUser,requirePermission('manage_patients'),requireAdminCsrf,(req,res)=>{
  const patientId = String(req.body.patientId || '').trim();
  const rows = readRows();
  const storedPatient = identityStore.snapshot().patients[patientId];
  const recordedPatient = patientId && !patientId.startsWith('legacy:')
    ? patientDirectory(rows).get(patientId)
    : null;
  const patient = storedPatient || recordedPatient;
  if (!patient || storedPatient?.reviewIdentity) {
    return res.status(404).send(patientManagementPage({
      error: 'The patient identity was not found.',
    }));
  }
  if (storedPatient?.quarantinedAt) {
    return res.status(409).send(patientManagementPage({
      error: 'A quarantined identity-collision record cannot be deleted through the portal.',
    }));
  }
  if (
    String(req.body.confirmation || '').trim().toUpperCase() !==
    supportId(patientId).toUpperCase()
  ) {
    return res.status(400).send(patientManagementPage({
      error: 'The Support ID confirmation did not match.',
    }));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = path.join(dataDir, 'backups');
  const csvBackup = path.join(
    backupDirectory,
    `before-delete-${stamp}-symptom_entries.csv`,
  );
  const identityBackup = path.join(
    backupDirectory,
    `before-delete-${stamp}-identity_store.json`,
  );
  fs.mkdirSync(backupDirectory, { recursive: true });
  ensureCsvFile();
  identityStore.snapshot();
  fs.copyFileSync(csvPath, csvBackup);
  fs.copyFileSync(identityStore.identityPath, identityBackup);

  try {
    const retainedRows = rows.filter(row => patientKey(row) !== patientId);
    const removedRows = rows.length - retainedRows.length;
    const deleted = storedPatient
      ? identityStore.deletePatient(patientId)
      : { deleted: false, devices: 0, codes: 0 };
    if (storedPatient && !deleted.deleted) {
      throw new Error('Patient identity deletion failed.');
    }
    writeCsvAtomically(retainedRows);
    return res.send(patientManagementPage({
      message: `${patient.displayName} was deleted. ${removedRows} submitted row(s), ${deleted.devices} device credential(s), and ${deleted.codes} enrolment code(s) were removed. Backup: ${path.basename(csvBackup)}.`,
    }));
  } catch (error) {
    fs.copyFileSync(csvBackup, csvPath);
    fs.copyFileSync(identityBackup, identityStore.identityPath);
    return res.status(500).send(patientManagementPage({
      error: `Deletion failed and the server backup was restored: ${error.message}`,
    }));
  }
});

function permissionCheckboxes(selected = [], locked = false) {
  return permissionDefinitions.map(permission =>
    `<label><input type="checkbox" name="permissions" value="${html(permission.id)}" ${selected.includes(permission.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>${html(permission.label)}</label>`
  ).join('');
}

function userManagementPage({ error = '', message = '' } = {}) {
  const users = portalUserStore.list();
  const csrfToken = adminCsrfToken();
  const drPascoeExists = users.some(user =>
    user.username.toLocaleLowerCase('en-AU') === 'dr pascoe');
  const notice = error
    ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>`
    : message
    ? `<div class="notice" style="border-color:#047857;background:#ecfdf5"><strong>${html(message)}</strong></div>`
    : '';
  const drPascoeForm = drPascoeExists ? '' : `
    <section class="panel"><h2>Create the Dr Pascoe account</h2>
      <p class="muted">This preset grants patient review, population analytics, enrolments, and disorder/symptom management only.</p>
      <form method="post" action="/admin/users/save" class="toolbar" autocomplete="off">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <input type="hidden" name="username" value="Dr Pascoe">
        <input type="hidden" name="preset" value="dr-pascoe">
        <div class="field"><label>Temporary password</label><input type="password" name="password" minlength="12" required autocomplete="new-password"></div>
        <div class="field"><label>&nbsp;</label><button type="submit">Create Dr Pascoe</button></div>
      </form>
    </section>`;
  const accountRows = users.map(user => {
    const isDrPascoe = user.username.toLocaleLowerCase('en-AU') === 'dr pascoe';
    return `
    <tr><td><strong>${html(user.username)}</strong><br><span class="muted">${user.active ? 'Active' : 'Disabled'}</span></td>
    <td><form method="post" action="/admin/users/save" autocomplete="off">
      <input type="hidden" name="csrfToken" value="${csrfToken}">
      <input type="hidden" name="username" value="${html(user.username)}">
      <div class="patient-list">${permissionCheckboxes(user.permissions, isDrPascoe)}</div>
      ${isDrPascoe ? '<p class="muted">The Dr Pascoe clinical permission set is fixed.</p>' : ''}
      <div class="toolbar" style="margin-top:10px">
        <div class="field"><label>New password (optional)</label><input type="password" name="password" minlength="12" autocomplete="new-password"></div>
        <div class="field"><label><input style="width:auto" type="checkbox" name="active" value="true" ${user.active ? 'checked' : ''}> Account active</label></div>
        <div class="field"><label>&nbsp;</label><button type="submit">Save account</button></div>
      </div>
    </form></td>
    <td><form method="post" action="/admin/users/delete" onsubmit="return confirm('Delete this clinician portal account?')">
      <input type="hidden" name="csrfToken" value="${csrfToken}">
      <input type="hidden" name="username" value="${html(user.username)}">
      <button class="danger" type="submit">Delete</button>
    </form></td></tr>`;
  }).join('');
  return pageShell('User accounts', `${notice}${drPascoeForm}
    <section class="panel"><h2>Create another user account</h2>
      <p class="muted">Select only the functions this person needs. Access is enforced on the server as well as in the navigation menu.</p>
      <form method="post" action="/admin/users/save" autocomplete="off">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <div class="toolbar">
          <div class="field"><label>Username</label><input name="username" maxlength="80" required></div>
          <div class="field"><label>Temporary password</label><input type="password" name="password" minlength="12" required autocomplete="new-password"></div>
        </div>
        <h3>Allowed functionality</h3><div class="patient-list">${permissionCheckboxes()}</div>
        <button style="width:auto;margin-top:12px" type="submit">Create user</button>
      </form>
    </section>
    <section class="panel"><h2>Existing user accounts</h2>
      <p class="muted">The protected ${html(adminUser)} account always retains full access and is configured on the server.</p>
      <div class="table-wrap"><table><thead><tr><th>User</th><th>Functionality</th><th>Remove</th></tr></thead>
      <tbody>${accountRows || '<tr><td colspan="3">No additional accounts have been created.</td></tr>'}</tbody></table></div>
    </section>`);
}

app.get('/admin/users',requirePortalUser,requireSystemAdmin,(req,res)=>{
  res.send(userManagementPage());
});

app.post('/admin/users/save',requirePortalUser,requireSystemAdmin,requireAdminCsrf,(req,res)=>{
  try {
    if (String(req.body.username || '').trim().toLocaleLowerCase('en-AU') ===
        adminUser.toLocaleLowerCase('en-AU')) {
      throw new Error('The protected admin account cannot be replaced.');
    }
    const isDrPascoe = String(req.body.username || '').trim()
      .toLocaleLowerCase('en-AU') === 'dr pascoe';
    const permissions = isDrPascoe
      ? [...drPascoePermissions]
      : req.body.permissions;
    const existing = portalUserStore.get(req.body.username);
    const user = portalUserStore.save({
      username: req.body.username,
      password: String(req.body.password || ''),
      permissions,
      active: existing ? req.body.active === 'true' : true,
    });
    res.send(userManagementPage({ message: `${user.username} was saved.` }));
  } catch (error) {
    res.status(400).send(userManagementPage({ error: error.message }));
  }
});

app.post('/admin/users/delete',requirePortalUser,requireSystemAdmin,requireAdminCsrf,(req,res)=>{
  const username = String(req.body.username || '').trim();
  const removed = portalUserStore.remove(username);
  res.status(removed ? 200 : 404).send(userManagementPage({
    [removed ? 'message' : 'error']: removed
      ? `${username} was deleted.`
      : 'The user account was not found.',
  }));
});

app.get('/admin/report.pdf',requirePortalUser,requirePermission('patient_review'),(req,res)=>{
  const allRows=readRows();
  const requestedId=String(req.query.patientId||'').trim();
  const selectedId=requestedId
    ? resolvePatientKey(allRows,requestedId,req.query.patient)
    : req.query.patient
    ? resolvePatientKey(allRows,'',req.query.patient)
    : '';
  const directory=patientDirectory(allRows);
  const selectedPatient=directory.get(selectedId);
  const selectedDisorderId=resolveDisorderKey(
    allRows,
    req.query.disorderId,
    req.query.disorder,
  );
  const rows=allRows.filter(r=>
    (!selectedId||patientKey(r)===selectedId)&&
    rowHasDisorder(r,selectedDisorderId)
  );
  const doc=new PDFDocument({margin:48});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="neurosol-clinical-report.pdf"');doc.pipe(res);
  doc.fontSize(20).text('NeuroSol Clinical Report');doc.moveDown();
  doc.fontSize(11).text(`Patient: ${selectedPatient?.displayName||'Cohort'}`);
  if (selectedPatient) doc.text(`Support ID: ${selectedPatient.supportId}`);
  doc.text(`Disorder: ${disorderLabel(allRows,selectedDisorderId)||'All'}`);doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`);doc.moveDown();
  const dates=unique(rows,'Date');doc.text(`Date range: ${dates[0]||'-'} to ${dates[dates.length-1]||'-'}`);doc.text(`Submission rows: ${rows.length}`);doc.moveDown();
  unique(rows,'Symptom').forEach(sym=>{const vals=rows.filter(r=>r.Symptom===sym).map(r=>r.ScoreNumber);doc.text(`${sym}: mean ${round1(mean(vals))}/10, range ${Math.min(...vals)}–${Math.max(...vals)}`)});
  const wellness=[...new Map(rows.filter(r=>r.WellnessNumber>0).map(r=>[`${patientKey(r)}|${r.Date}`,r.WellnessNumber])).values()];doc.moveDown().text(`Average wellness: ${round1(mean(wellness))}%`);
  doc.end();
});

app.get('/admin',requirePortalUser,requirePermission('patient_review'),(req,res)=>{
  const rows=readRows(), directory=patientDirectory(rows), disorders=disorderChoices(rows);
  const patients=[...directory.values()].sort((a,b)=>a.label.localeCompare(b.label));
  const patientId=resolvePatientKey(rows,req.query.patientId,req.query.patient);
  const selectedPatient=directory.get(patientId);
  const disorderId=resolveDisorderKey(
    rows,
    req.query.disorderId,
    req.query.disorder,
  );
  const aggregation=['daily','weekly','fortnightly','monthly'].includes(req.query.aggregation)?req.query.aggregation:'weekly';
  const calendarDays=[30,60,90].includes(Number(req.query.calendarDays))?Number(req.query.calendarDays):30;
  const requestedMetric=String(req.query.metric||'wellness');
  const metric=requestedMetric==='symptom'||requestedMetric==='wellness'||requestedMetric.startsWith('symptom:')?requestedMetric:'wellness';
  const filtered=rows.filter(r=>(!patientId||patientKey(r)===patientId)&&rowHasDisorder(r,disorderId));
  const series=patientSeries(filtered,disorderId,metric,aggregation,patientId?[patientId]:[],directory);
  const dates=unique(filtered,'Date'), symptoms=unique(filtered,'Symptom');
  const avgSym=round1(mean(filtered.map(r=>r.ScoreNumber)));
  const wellness=[...new Map(filtered.filter(r=>r.WellnessNumber>0).map(r=>[`${patientKey(r)}|${r.Date}`,r.WellnessNumber])).values()];
  const latest=[...filtered].sort((a,b)=>`${b.Date}${b.Time}`.localeCompare(`${a.Date}${a.Time}`)).slice(0,120);
  const disorderOptionsHtml='<option value="">All</option>'+disorders.map(item=>`<option value="${html(item.id)}" ${item.id===disorderId?'selected':''}>${html(item.displayName)}</option>`).join('');
  const patientOptions=patients.map(patient=>`<option value="${html(patient.patientId)}" ${patient.patientId===patientId?'selected':''}>${html(patient.label)}</option>`).join('');
  const body=`<div class="cards"><div class="stat"><div class="label">Patient</div><div class="value" style="font-size:19px">${html(selectedPatient?.displayName||'-')}</div></div><div class="stat"><div class="label">Support ID</div><div class="value" style="font-size:19px">${html(selectedPatient?.supportId||'-')}</div></div><div class="stat"><div class="label">Reporting days</div><div class="value">${dates.length}</div></div><div class="stat"><div class="label">Average wellness</div><div class="value">${round1(mean(wellness))}%</div></div><div class="stat"><div class="label">Average symptom</div><div class="value">${avgSym}/10</div></div></div>
  <form class="panel toolbar"><div class="field"><label>Patient</label><select name="patientId">${patientOptions}</select></div><div class="field"><label>Disorder</label><select name="disorderId">${disorderOptionsHtml}</select></div><div class="field"><label>Metric</label><select name="metric"><option value="wellness" ${metric==='wellness'?'selected':''}>Wellness</option><option value="symptom" ${metric==='symptom'?'selected':''}>Average symptom score</option>${symptoms.map(sym=>`<option value="symptom:${html(sym)}" ${metric===`symptom:${sym}`?'selected':''}>${html(sym)}</option>`).join('')}</select></div><div class="field"><label>Aggregation</label><select name="aggregation">${['daily','weekly','fortnightly','monthly'].map(x=>`<option value="${x}" ${x===aggregation?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="field"><label>Calendar range</label><select name="calendarDays">${[30,60,90].map(days=>`<option value="${days}" ${days===calendarDays?'selected':''}>Last ${days} days</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button>Update view</button></div></form>
  <section class="panel"><h2>${metric==='wellness'?'Wellness trend':metric.startsWith('symptom:')?`${html(metric.slice('symptom:'.length))} trend`:'Average symptom trend'}</h2><p class="muted">Weekly aggregation is the default to reduce day-to-day noise. Y-axis is fixed for direct clinical comparison.</p>${svgChart(series,metric,aggregation,'overlay',patientId)}<div class="legend"><span><i class="swatch" style="background:#2563eb"></i>Selected patient</span></div></section>
  <section class="panel"><h2>${html(metricLabel(metric))} daily calendar</h2><p class="muted">Each box is one day. Marker size reflects the recorded value; hover over a day for the exact score.</p>${renderMetricCalendar(filtered,metric,calendarDays)}</section>
  <section class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><div><h2>Clinical record</h2><p class="muted">${html(symptoms.join(', '))}</p></div><a class="button" style="width:auto" target="_blank" href="/admin/report.pdf?patientId=${encodeURIComponent(patientId)}&disorderId=${encodeURIComponent(disorderId)}">Generate PDF</a></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Track</th><th>Disorder</th><th>Symptom</th><th>Score</th><th>Wellness</th></tr></thead><tbody>${latest.map(r=>`<tr><td>${html(r.Date)}</td><td>${html(r.Time)}</td><td>${html(r.Track)}</td><td>${html(rowDisorderLabel(r))}</td><td>${html(r.Symptom)}</td><td>${r.ScoreNumber}</td><td>${r.WellnessNumber}%</td></tr>`).join('')}</tbody></table></div></section>`;
  res.send(pageShell('Patient review',body));
});

app.get('/admin/population',requirePortalUser,requirePermission('population_analytics'),(req,res)=>{
  const rows=readRows(), directory=patientDirectory(rows), disorders=disorderChoices(rows);
  const disorderId=resolveDisorderKey(rows,req.query.disorderId,req.query.disorder)||disorders[0]?.id||'', metric=req.query.metric==='symptom'?'symptom':'wellness';
  const disorder=disorderLabel(rows,disorderId);
  const aggregation=['daily','weekly','fortnightly','monthly'].includes(req.query.aggregation)?req.query.aggregation:'weekly';
  const allPatients=[...new Set(rows.filter(r=>rowHasDisorder(r,disorderId)).map(patientKey).filter(Boolean))]
    .filter(patientId => !directory.get(patientId)?.quarantined)
    .sort((a,b)=>(directory.get(a)?.label||a).localeCompare(directory.get(b)?.label||b));
  const selected=String(req.query.patients||'').split('|').filter(x=>allPatients.includes(x)).slice(0,10);
  const cohort=patientSeries(rows,disorderId,metric,aggregation,[],directory);
  const overlayPatients=selected.length?selected:allPatients.slice(0,10);
  const overlay=patientSeries(rows,disorderId,metric,aggregation,overlayPatients,directory);
  const summary=cohortSeries(cohort,metric), latest=summary[summary.length-1]||{average:0,median:0,count:0};
  const statuses=cohort.map(p=>({patient:p.patient,label:p.label||p.patient,status:classifyPatientTrend(p,metric),latest:p.series[p.series.length-1]?.value||0}));
  const improving=statuses.filter(x=>x.status==='Improving').length, deteriorating=statuses.filter(x=>x.status==='Deteriorating').length;
  const deviations=statuses.map(s=>({ ...s, deviation:round1(s.latest-latest.average) })).sort((a,b)=>Math.abs(b.deviation)-Math.abs(a.deviation));
  const threshold=metric==='wellness'?20:2;
  const flagged=deviations.filter(x=>Math.abs(x.deviation)>=threshold);
  const options=disorders.map(item=>`<option value="${html(item.id)}" ${item.id===disorderId?'selected':''}>${html(item.displayName)}</option>`).join('');
  const patientChecks=allPatients.map(patientId=>`<label><input type="checkbox" name="patient" value="${html(patientId)}" ${overlayPatients.includes(patientId)?'checked':''}>${html(directory.get(patientId)?.label||patientId)}</label>`).join('');
  const body=`<div class="cards"><div class="stat"><div class="label">Disorder</div><div class="value" style="font-size:20px">${html(disorder)}</div></div><div class="stat"><div class="label">Patients</div><div class="value">${cohort.length}</div></div><div class="stat"><div class="label">Latest cohort mean</div><div class="value">${latest.average}${metric==='wellness'?'%':'/10'}</div></div><div class="stat"><div class="label">Improving</div><div class="value good">${improving}</div></div><div class="stat"><div class="label">Deteriorating</div><div class="value flag">${deteriorating}</div></div><div class="stat"><div class="label">Cohort outliers</div><div class="value">${flagged.length}</div></div></div>
  <form class="panel toolbar" id="filters"><div class="field"><label>Disorder</label><select name="disorderId">${options}</select></div><div class="field"><label>Metric</label><select name="metric"><option value="wellness" ${metric==='wellness'?'selected':''}>Wellness</option><option value="symptom" ${metric==='symptom'?'selected':''}>Average symptom score</option></select></div><div class="field"><label>Aggregation</label><select name="aggregation">${['daily','weekly','fortnightly','monthly'].map(x=>`<option value="${x}" ${x===aggregation?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button type="button" onclick="applyFilters()">Update view</button></div></form>
  <section class="panel"><h2>Cohort summary</h2><p class="muted">Faint grey lines are individual patients. Blue is the cohort mean, purple dashed is the median, and the shaded band is ±1 standard deviation.</p>${svgChart(cohort,metric,aggregation,'summary')}<div class="legend"><span><i class="swatch" style="background:#1d4ed8"></i>Cohort mean</span><span><i class="swatch" style="background:#7c3aed"></i>Median</span><span><i class="swatch" style="background:#93c5fd;height:12px"></i>±1 SD</span></div></section>
  <section class="panel"><h2>Patient overlay</h2><p class="muted">Select up to 10 patients for a legible comparison. The first 10 are shown by default.</p><div class="patient-list" id="patientList">${patientChecks}</div><div style="display:flex;gap:8px;margin:10px 0 16px"><button style="width:auto" onclick="selectFirstTen()">First 10</button><button class="button secondary" style="width:auto" onclick="clearPatients()">Clear</button></div>${svgChart(overlay,metric,aggregation,'overlay')}</section>
  <section class="panel"><h2>Outliers and response status</h2><p class="muted">Outliers compare each patient's latest aggregated value with the latest cohort mean. Threshold: ${threshold}${metric==='wellness'?' percentage points':' score points'}.</p><div class="table-wrap"><table><thead><tr><th>Patient</th><th>Status</th><th>Latest</th><th>Deviation</th><th>Flag</th></tr></thead><tbody>${deviations.map(x=>`<tr><td>${html(x.label)}</td><td class="${x.status==='Improving'?'good':x.status==='Deteriorating'?'flag':''}">${x.status}</td><td>${x.latest}${metric==='wellness'?'%':'/10'}</td><td>${x.deviation>0?'+':''}${x.deviation}</td><td class="${Math.abs(x.deviation)>=threshold?'flag':''}">${Math.abs(x.deviation)>=threshold?'Cohort outlier':'Within range'}</td></tr>`).join('')}</tbody></table></div></section>
  <script>function applyFilters(){const f=document.getElementById('filters');const q=new URLSearchParams(new FormData(f));const checked=[...document.querySelectorAll('#patientList input:checked')].slice(0,10).map(x=>x.value);if(checked.length)q.set('patients',checked.join('|'));location.href='/admin/population?'+q.toString()}function clearPatients(){document.querySelectorAll('#patientList input').forEach(x=>x.checked=false)}function selectFirstTen(){[...document.querySelectorAll('#patientList input')].forEach((x,i)=>x.checked=i<10)}</script>`;
  res.send(pageShell('Population analytics',body));
});

if (require.main === module) {
  const server = app.listen(port,host,()=>console.log(`NeuroSol listening on http://${host}:${port}`));

  const shutdown = signal => {
    console.log(`${signal} received. Shutting down NeuroSol...`);
    server.close(error => {
      if (error) {
        console.error('Error while shutting down:',error);
        process.exitCode=1;
      }
    });
  };

  process.on('SIGINT',()=>shutdown('SIGINT'));
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
}

module.exports = {
  app,
  csvPath,
  disorderCatalog,
  disorderChoices,
  disorderKey,
  identityStore,
  portalUserStore,
  patientDirectory,
  patientSeries,
  buildCalendarDays,
  renderMetricCalendar,
  todayIso,
};
