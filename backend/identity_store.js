const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  isIndependentClinicalProfile,
  normaliseClinicalProfile,
  profileMinimumBuild,
  reviewClinicalProfile,
  sameClinicalProfile,
} = require('./clinical_profiles');
const { staticDisorderCatalog } = require('./disorder_catalog');

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normaliseCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(value) {
  const compact = normaliseCode(value);
  return compact.match(/.{1,4}/g)?.join('-') || compact;
}

function supportId(patientId) {
  const compact = String(patientId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return 'NS-UNAVAILABLE';
  const suffix = compact.slice(-12);
  return `NS-${suffix.match(/.{1,4}/g).join('-')}`;
}

function randomCode() {
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let index = 0; index < 12; index++) {
    code += codeAlphabet[bytes[index] % codeAlphabet.length];
  }
  return code;
}

function createIdentityStore({
  dataDir,
  secret,
  now = () => new Date(),
  disorderCatalog = staticDisorderCatalog,
}) {
  if (!secret || String(secret).length < 32) {
    throw new Error('IDENTITY_SECRET must contain at least 32 characters.');
  }

  const identityPath = path.join(dataDir, 'identity_store.json');

  function emptyStore() {
    return {
      version: 3,
      patients: {},
      enrolmentCodes: {},
      devices: {},
    };
  }

  function ensureStore() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(identityPath)) {
      writeStore(emptyStore());
    }
  }

  function readStore() {
    ensureStore();
    const parsed = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    return {
      ...emptyStore(),
      ...parsed,
      version: Math.max(Number(parsed.version) || 1, 3),
      patients: parsed.patients || {},
      enrolmentCodes: parsed.enrolmentCodes || {},
      devices: parsed.devices || {},
    };
  }

  function writeStore(store) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temporaryPath = `${identityPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, identityPath);
  }

  function digest(kind, value) {
    return crypto
      .createHmac('sha256', String(secret))
      .update(`${kind}:${value}`)
      .digest('hex');
  }

  function applyDeviceCompatibility(device, compatibility, observedAt) {
    const build = Number(compatibility?.mobileBuild);
    const payloadSchema = Number(compatibility?.payloadSchemaVersion);
    if (Number.isInteger(build) && build > 0) {
      device.lastMobileBuild = build;
    }
    if (typeof compatibility?.supportsClinicManagedProfile === 'boolean') {
      device.supportsClinicManagedProfile =
        compatibility.supportsClinicManagedProfile;
    }
    if (typeof compatibility?.supportsCanonicalDisorders === 'boolean') {
      device.supportsCanonicalDisorders =
        compatibility.supportsCanonicalDisorders;
    }
    if (typeof compatibility?.supportsIndependentProfiles === 'boolean') {
      device.supportsIndependentProfiles =
        compatibility.supportsIndependentProfiles;
    }
    if ([1, 2, 3].includes(payloadSchema)) {
      device.lastPayloadSchemaVersion = payloadSchema;
    }
    if (
      (Number.isInteger(build) && build > 0) ||
      [1, 2, 3].includes(payloadSchema) ||
      typeof compatibility?.supportsClinicManagedProfile === 'boolean' ||
      typeof compatibility?.supportsCanonicalDisorders === 'boolean' ||
      typeof compatibility?.supportsIndependentProfiles === 'boolean'
    ) {
      device.lastCompatibilityAt = observedAt;
    }
  }

  function createPatientId() {
    return `pt-${crypto.randomUUID()}`;
  }

  function validatePatientIdentity(patientId, displayName) {
    const id = String(patientId || '').trim() || createPatientId();
    const name = String(displayName || '').trim();
    if (!name || name.length > 160) {
      throw new Error('A patient display name is required.');
    }
    if (id.length > 120) throw new Error('PatientId is invalid.');
    return { id, name };
  }

  function saveClinicalProfile({
    patientId = '',
    displayName = '',
    clinicalProfile = {},
  }) {
    const { id, name } = validatePatientIdentity(patientId, displayName);
    const profile = normaliseClinicalProfile(clinicalProfile, {
      disorderCatalog,
    });
    const store = readStore();
    const savedAt = now().toISOString();
    const existing = store.patients[id];
    const previousProfile = existing?.clinicalProfile || null;
    const changed = !previousProfile ||
      !sameClinicalProfile(previousProfile, profile);
    const revision = changed
      ? Number(previousProfile?.revision || 0) + 1
      : Number(previousProfile.revision);
    const savedProfile = changed
      ? {
          ...profile,
          revision,
          updatedAt: savedAt,
        }
      : previousProfile;
    const history = Array.isArray(existing?.clinicalProfileHistory)
      ? [...existing.clinicalProfileHistory]
      : previousProfile
      ? [previousProfile]
      : [];
    if (changed) history.push(savedProfile);

    store.patients[id] = {
      ...existing,
      patientId: id,
      displayName: name,
      createdAt: existing?.createdAt || savedAt,
      updatedAt: savedAt,
      clinicalProfile: savedProfile,
      clinicalProfileHistory: history,
    };
    writeStore(store);

    return {
      patientId: id,
      displayName: name,
      supportId: supportId(id),
      clinicalProfile: savedProfile,
    };
  }

  function issueEnrolmentCode({
    patientId = '',
    displayName = '',
    expiresInDays = 7,
    requireClinicalProfile = false,
  }) {
    const store = readStore();
    const { id, name } = validatePatientIdentity(patientId, displayName);

    const issuedAt = now();
    const expiresAt = new Date(
      issuedAt.getTime() + Number(expiresInDays) * 24 * 60 * 60 * 1000,
    );
    let compactCode;
    let codeHash;
    do {
      compactCode = randomCode();
      codeHash = digest('enrolment-code', compactCode);
    } while (store.enrolmentCodes[codeHash]);

    const existing = store.patients[id];
    if (requireClinicalProfile && !existing?.clinicalProfile) {
      throw new Error(
        'Configure the patient’s clinical profile before issuing a code.',
      );
    }
    store.patients[id] = {
      ...existing,
      patientId: id,
      displayName: name,
      createdAt: existing?.createdAt || issuedAt.toISOString(),
      updatedAt: issuedAt.toISOString(),
    };
    store.enrolmentCodes[codeHash] = {
      patientId: id,
      createdAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      clinicManaged: Boolean(existing?.clinicalProfile),
      profileRevision: existing?.clinicalProfile?.revision || null,
    };
    writeStore(store);

    return {
      patientId: id,
      displayName: name,
      code: formatCode(compactCode),
      expiresAt: expiresAt.toISOString(),
      supportId: supportId(id),
      clinicalProfile: existing?.clinicalProfile || null,
    };
  }

  function redeemEnrolmentCode(
    value,
    {
      expectedPatientId = '',
      supportsClinicManagedProfile = false,
      supportsCanonicalDisorders = false,
      supportsIndependentProfiles = false,
      supportedMobileBuild = null,
    } = {},
  ) {
    const compactCode = normaliseCode(value);
    if (compactCode.length !== 12) return { status: 'invalid' };

    const store = readStore();
    const codeHash = digest('enrolment-code', compactCode);
    const record = store.enrolmentCodes[codeHash];
    if (!record) return { status: 'invalid' };
    if (record.usedAt) return { status: 'used' };
    if (new Date(record.expiresAt).getTime() <= now().getTime()) {
      return { status: 'expired' };
    }
    const expectedId = String(expectedPatientId || '').trim();
    if (expectedId && record.patientId !== expectedId) {
      return { status: 'patient_mismatch' };
    }

    const patient = store.patients[record.patientId];
    if (!patient) return { status: 'invalid' };
    const effectiveSupportedBuild = Number.isInteger(supportedMobileBuild)
      ? supportedMobileBuild
      : supportsClinicManagedProfile
      ? 7
      : 6;
    if (patient.clinicalProfile) {
      const requiredBuild = profileMinimumBuild(patient.clinicalProfile);
      if (
        !supportsClinicManagedProfile ||
        effectiveSupportedBuild < requiredBuild ||
        (requiredBuild >= 8 && !supportsCanonicalDisorders) ||
        (isIndependentClinicalProfile(patient.clinicalProfile) &&
          !supportsIndependentProfiles)
      ) {
        return { status: 'upgrade_required', requiredBuild };
      }
    }

    const accessToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = digest('device-token', accessToken);
    const deviceId = crypto.randomUUID();
    const redeemedAt = now().toISOString();
    record.usedAt = redeemedAt;
    const device = {
      deviceId,
      patientId: record.patientId,
      createdAt: redeemedAt,
      lastUsedAt: redeemedAt,
      revokedAt: null,
    };
    applyDeviceCompatibility(device, {
      mobileBuild: effectiveSupportedBuild,
      supportsClinicManagedProfile,
      supportsCanonicalDisorders,
      supportsIndependentProfiles,
    }, redeemedAt);
    store.devices[tokenHash] = device;
    writeStore(store);

    return {
      status: 'ok',
      accessToken,
      deviceId,
      patientId: record.patientId,
      displayName: patient.displayName,
      supportId: supportId(record.patientId),
      clinicalProfile: patient.clinicalProfile || null,
    };
  }

  function enrolReusableReviewDevice({
    patientId = '',
    displayName = '',
    supportedMobileBuild = null,
    supportsClinicManagedProfile = false,
    supportsCanonicalDisorders = false,
    supportsIndependentProfiles = false,
  } = {}) {
    const id = String(patientId || '').trim();
    const name = String(displayName || '').trim();
    if (!id.startsWith('pt-review-') || id.length > 120) {
      throw new Error('Review PatientId must start with pt-review-.');
    }
    if (!name || name.length > 160) {
      throw new Error('A review display name is required.');
    }

    const store = readStore();
    const enrolledAt = now().toISOString();
    const existing = store.patients[id];
    const normalisedReviewProfile = normaliseClinicalProfile(
      reviewClinicalProfile,
      { disorderCatalog: staticDisorderCatalog },
    );
    const previousProfile = existing?.clinicalProfile;
    const changed = !previousProfile ||
      !sameClinicalProfile(previousProfile, normalisedReviewProfile);
    const clinicalProfile = changed
      ? {
          ...normalisedReviewProfile,
          revision: Number(previousProfile?.revision || 0) + 1,
          updatedAt: enrolledAt,
        }
      : previousProfile;
    const history = Array.isArray(existing?.clinicalProfileHistory)
      ? [...existing.clinicalProfileHistory]
      : previousProfile
      ? [previousProfile]
      : [];
    if (changed) history.push(clinicalProfile);
    store.patients[id] = {
      ...existing,
      patientId: id,
      displayName: name,
      createdAt: existing?.createdAt || enrolledAt,
      updatedAt: enrolledAt,
      reviewIdentity: true,
      clinicalProfile,
      clinicalProfileHistory: history,
    };

    const accessToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = digest('device-token', accessToken);
    const deviceId = crypto.randomUUID();
    const device = {
      deviceId,
      patientId: id,
      createdAt: enrolledAt,
      lastUsedAt: enrolledAt,
      revokedAt: null,
      reviewDevice: true,
    };
    applyDeviceCompatibility(device, {
      mobileBuild: supportedMobileBuild,
      supportsClinicManagedProfile,
      supportsCanonicalDisorders,
      supportsIndependentProfiles,
    }, enrolledAt);
    store.devices[tokenHash] = device;
    writeStore(store);

    return {
      status: 'ok',
      accessToken,
      deviceId,
      patientId: id,
      displayName: name,
      supportId: supportId(id),
      clinicalProfile,
    };
  }

  function authenticate(accessToken, compatibility = {}) {
    const token = String(accessToken || '').trim();
    if (!token) return null;
    const store = readStore();
    const tokenHash = digest('device-token', token);
    const device = store.devices[tokenHash];
    if (!device || device.revokedAt) return null;

    const usedAt = now().toISOString();
    device.lastUsedAt = usedAt;
    applyDeviceCompatibility(device, compatibility, usedAt);
    writeStore(store);
    return {
      ...device,
      patient: store.patients[device.patientId] || null,
    };
  }

  function recordPayloadSchema(accessToken, schemaVersion) {
    const token = String(accessToken || '').trim();
    const schema = Number(schemaVersion);
    if (!token || ![1, 2, 3].includes(schema)) return false;
    const store = readStore();
    const tokenHash = digest('device-token', token);
    const device = store.devices[tokenHash];
    if (!device || device.revokedAt) return false;
    applyDeviceCompatibility(device, {
      payloadSchemaVersion: schema,
    }, now().toISOString());
    writeStore(store);
    return true;
  }

  function revokePatientDevices(patientId) {
    const id = String(patientId || '').trim();
    const store = readStore();
    const revokedAt = now().toISOString();
    let revoked = 0;
    for (const device of Object.values(store.devices)) {
      if (device.patientId === id && !device.revokedAt) {
        device.revokedAt = revokedAt;
        revoked++;
      }
    }
    writeStore(store);
    return revoked;
  }

  function updatePatientDisplayName(patientId, displayName) {
    const id = String(patientId || '').trim();
    const name = String(displayName || '').trim();
    if (!id || !name || name.length > 160) return;
    const store = readStore();
    const existing = store.patients[id];
    store.patients[id] = {
      ...existing,
      patientId: id,
      displayName: name,
      createdAt: existing?.createdAt || now().toISOString(),
      updatedAt: now().toISOString(),
    };
    writeStore(store);
  }

  function patientClinicalProfile(patientId, revision = null) {
    const id = String(patientId || '').trim();
    const patient = readStore().patients[id];
    if (!patient) return null;
    if (revision == null) return patient.clinicalProfile || null;
    const history = Array.isArray(patient.clinicalProfileHistory)
      ? patient.clinicalProfileHistory
      : patient.clinicalProfile
      ? [patient.clinicalProfile]
      : [];
    return history.find(
      profile => Number(profile.revision) === Number(revision),
    ) || null;
  }

  function profileIdentifiers(profile) {
    if (isIndependentClinicalProfile(profile)) {
      return {
        schemaVersion: 3,
        disorderIds: [...(profile.disorderIds || [])],
        symptomIds: [...(profile.symptomIds || [])],
      };
    }
    return {
      schemaVersion: Number(profile?.schemaVersion) || 2,
      primaryDisorderId: profile?.primaryDisorderId,
      primarySymptomIds: [...(profile?.primarySymptomIds || [])],
      secondaryDisorderId: profile?.secondaryDisorderId,
      secondarySymptomIds: [...(profile?.secondarySymptomIds || [])],
    };
  }

  function refreshProfilesWhere(matches) {
    const store = readStore();
    const refreshedAt = now().toISOString();
    let updatedPatients = 0;
    for (const patient of Object.values(store.patients)) {
      const previousProfile = patient?.clinicalProfile;
      if (!previousProfile || !matches(previousProfile)) continue;
      const refreshedProfile = normaliseClinicalProfile(
        profileIdentifiers(previousProfile),
        {
          disorderCatalog,
          includeInactive: true,
          allowHistoricalSymptoms: true,
        },
      );
      if (sameClinicalProfile(previousProfile, refreshedProfile)) continue;
      const savedProfile = {
        ...refreshedProfile,
        revision: Number(previousProfile.revision || 0) + 1,
        updatedAt: refreshedAt,
      };
      const history = Array.isArray(patient.clinicalProfileHistory)
        ? [...patient.clinicalProfileHistory]
        : [previousProfile];
      history.push(savedProfile);
      patient.clinicalProfile = savedProfile;
      patient.clinicalProfileHistory = history;
      patient.updatedAt = refreshedAt;
      updatedPatients++;
    }
    if (updatedPatients) writeStore(store);
    return updatedPatients;
  }

  function refreshProfilesForDisorder(disorderId) {
    const id = String(disorderId || '').trim();
    if (!id) throw new Error('A disorder identifier is required.');
    return refreshProfilesWhere(profile =>
      profile.primaryDisorderId === id ||
      profile.secondaryDisorderId === id ||
      (profile.disorderIds || []).includes(id)
    );
  }

  function refreshProfilesForSymptom(symptomId) {
    const id = String(symptomId || '').trim();
    if (!id) throw new Error('A symptom identifier is required.');
    return refreshProfilesWhere(profile =>
      (profile.primarySymptomIds || []).includes(id) ||
      (profile.secondarySymptomIds || []).includes(id) ||
      (profile.symptomIds || []).includes(id)
    );
  }

  function reconcileCurrentProfiles() {
    const store = readStore();
    const reconciledAt = now().toISOString();
    let updatedPatients = 0;
    for (const patient of Object.values(store.patients)) {
      const previousProfile = patient?.clinicalProfile;
      if (!previousProfile) continue;
      const refreshedProfile = normaliseClinicalProfile(
        profileIdentifiers(previousProfile),
        {
          disorderCatalog,
          includeInactive: true,
          allowHistoricalSymptoms: true,
        },
      );
      if (sameClinicalProfile(previousProfile, refreshedProfile)) continue;
      const savedProfile = {
        ...refreshedProfile,
        revision: Number(previousProfile.revision || 0) + 1,
        updatedAt: reconciledAt,
      };
      const history = Array.isArray(patient.clinicalProfileHistory)
        ? [...patient.clinicalProfileHistory]
        : [previousProfile];
      history.push(savedProfile);
      patient.clinicalProfile = savedProfile;
      patient.clinicalProfileHistory = history;
      patient.updatedAt = reconciledAt;
      updatedPatients++;
    }
    if (updatedPatients) writeStore(store);
    return updatedPatients;
  }

  function migrateCanonicalProfiles() {
    ensureStore();
    const originalText = fs.readFileSync(identityPath, 'utf8');
    const parsed = JSON.parse(originalText);
    const store = {
      ...emptyStore(),
      ...parsed,
      version: 3,
      patients: parsed.patients || {},
      enrolmentCodes: parsed.enrolmentCodes || {},
      devices: parsed.devices || {},
    };
    let migratedProfiles = 0;

    function canonicalise(profile) {
      if (!profile) return null;
      if (isIndependentClinicalProfile(profile)) {
        const validated = normaliseClinicalProfile(profileIdentifiers(profile), {
          disorderCatalog,
          includeInactive: true,
          allowHistoricalSymptoms: true,
        });
        return {
          ...validated,
          disorders: Array.isArray(profile.disorders) &&
            profile.disorders.length === validated.disorders.length
            ? [...profile.disorders]
            : validated.disorders,
          symptoms: Array.isArray(profile.symptoms) &&
            profile.symptoms.length === validated.symptoms.length
            ? [...profile.symptoms]
            : validated.symptoms,
          revision: Number(profile.revision || 0),
          updatedAt: profile.updatedAt,
        };
      }
      const hasCanonicalIdentifiers =
        Number(profile.schemaVersion) >= 2 &&
        String(profile.primaryDisorderId || '').trim() &&
        Array.isArray(profile.primarySymptomIds) &&
        profile.primarySymptomIds.length === 3;
      if (hasCanonicalIdentifiers) {
        const validated = normaliseClinicalProfile({
          primaryDisorderId: profile.primaryDisorderId,
          primarySymptomIds: profile.primarySymptomIds,
          secondaryDisorderId: profile.secondaryDisorderId,
          secondarySymptomIds: profile.secondarySymptomIds,
        }, {
          disorderCatalog,
          includeInactive: true,
          allowHistoricalSymptoms: true,
        });
        const primarySymptoms = Array.isArray(profile.primarySymptoms) &&
          profile.primarySymptoms.length === 3
          ? [...profile.primarySymptoms]
          : validated.primarySymptoms;
        const hasSecondary = Boolean(validated.secondaryDisorderId);
        const secondarySymptoms = hasSecondary &&
          Array.isArray(profile.secondarySymptoms) &&
          profile.secondarySymptoms.length === 3
          ? [...profile.secondarySymptoms]
          : validated.secondarySymptoms;
        return {
          ...validated,
          primaryDisorder: String(profile.primaryDisorder || '').trim() ||
            validated.primaryDisorder,
          primarySymptoms,
          secondaryDisorder: hasSecondary
            ? String(profile.secondaryDisorder || '').trim() ||
              validated.secondaryDisorder
            : null,
          secondarySymptoms,
          revision: Number(profile.revision || 0),
          updatedAt: profile.updatedAt,
        };
      }
      const canonical = normaliseClinicalProfile(profile, {
        disorderCatalog,
        includeInactive: true,
        allowHistoricalSymptoms: true,
      });
      return {
        ...canonical,
        revision: Number(profile.revision || 0),
        updatedAt: profile.updatedAt,
      };
    }

    for (const patient of Object.values(store.patients)) {
      if (!patient?.clinicalProfile) continue;
      const before = JSON.stringify({
        current: patient.clinicalProfile,
        history: patient.clinicalProfileHistory || [],
      });
      const history = Array.isArray(patient.clinicalProfileHistory)
        ? patient.clinicalProfileHistory.map(canonicalise)
        : [];
      patient.clinicalProfile = canonicalise(patient.clinicalProfile);
      patient.clinicalProfileHistory = history.length
        ? history
        : [patient.clinicalProfile];
      const after = JSON.stringify({
        current: patient.clinicalProfile,
        history: patient.clinicalProfileHistory,
      });
      if (before !== after) migratedProfiles++;
    }

    const repairedText = `${JSON.stringify(store, null, 2)}\n`;
    if (originalText === repairedText) {
      return { migrated: false, migratedProfiles, backupPath: null };
    }
    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      backupDir,
      `identity_store.pre-build8-${stamp}.json`,
    );
    fs.copyFileSync(identityPath, backupPath);
    writeStore(store);
    return { migrated: true, migratedProfiles, backupPath };
  }

  function deletePatient(patientId) {
    const id = String(patientId || '').trim();
    const store = readStore();
    if (!id || !store.patients[id]) {
      return { deleted: false, codes: 0, devices: 0 };
    }
    delete store.patients[id];
    let codes = 0;
    let devices = 0;
    for (const [codeHash, record] of Object.entries(store.enrolmentCodes)) {
      if (record.patientId === id) {
        delete store.enrolmentCodes[codeHash];
        codes++;
      }
    }
    for (const [tokenHash, device] of Object.entries(store.devices)) {
      if (device.patientId === id) {
        delete store.devices[tokenHash];
        devices++;
      }
    }
    writeStore(store);
    return { deleted: true, codes, devices };
  }

  function snapshot() {
    return readStore();
  }

  function compatibilitySummary() {
    const activeDevices = Object.values(readStore().devices)
      .filter(device => !device.revokedAt);
    const builds = {};
    const payloadSchemas = {};
    for (const device of activeDevices) {
      const buildKey = Number.isInteger(device.lastMobileBuild)
        ? String(device.lastMobileBuild)
        : 'unknown';
      const schemaKey = [1, 2, 3].includes(device.lastPayloadSchemaVersion)
        ? String(device.lastPayloadSchemaVersion)
        : 'unknown';
      builds[buildKey] = (builds[buildKey] || 0) + 1;
      payloadSchemas[schemaKey] = (payloadSchemas[schemaKey] || 0) + 1;
    }
    return {
      activeDevices: activeDevices.length,
      builds,
      payloadSchemas,
      canonicalDevices: activeDevices.filter(
        device => device.supportsCanonicalDisorders === true,
      ).length,
      independentProfileDevices: activeDevices.filter(
        device => device.supportsIndependentProfiles === true,
      ).length,
    };
  }

  return {
    identityPath,
    deletePatient,
    issueEnrolmentCode,
    saveClinicalProfile,
    redeemEnrolmentCode,
    enrolReusableReviewDevice,
    authenticate,
    recordPayloadSchema,
    patientClinicalProfile,
    refreshProfilesForDisorder,
    refreshProfilesForSymptom,
    reconcileCurrentProfiles,
    migrateCanonicalProfiles,
    revokePatientDevices,
    updatePatientDisplayName,
    snapshot,
    compatibilitySummary,
  };
}

module.exports = {
  createIdentityStore,
  formatCode,
  normaliseCode,
  supportId,
};
