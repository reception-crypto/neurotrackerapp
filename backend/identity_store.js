const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

function createIdentityStore({ dataDir, secret, now = () => new Date() }) {
  if (!secret || String(secret).length < 32) {
    throw new Error('IDENTITY_SECRET must contain at least 32 characters.');
  }

  const identityPath = path.join(dataDir, 'identity_store.json');

  function emptyStore() {
    return {
      version: 1,
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

  function createPatientId() {
    return `pt-${crypto.randomUUID()}`;
  }

  function issueEnrolmentCode({
    patientId = '',
    displayName = '',
    expiresInDays = 7,
  }) {
    const store = readStore();
    const id = String(patientId || '').trim() || createPatientId();
    const name = String(displayName || '').trim();
    if (!name || name.length > 160) {
      throw new Error('A patient display name is required.');
    }
    if (id.length > 120) throw new Error('PatientId is invalid.');

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
    store.patients[id] = {
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
    };
    writeStore(store);

    return {
      patientId: id,
      displayName: name,
      code: formatCode(compactCode),
      expiresAt: expiresAt.toISOString(),
      supportId: supportId(id),
    };
  }

  function redeemEnrolmentCode(value, { expectedPatientId = '' } = {}) {
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

    const accessToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = digest('device-token', accessToken);
    const deviceId = crypto.randomUUID();
    const redeemedAt = now().toISOString();
    record.usedAt = redeemedAt;
    store.devices[tokenHash] = {
      deviceId,
      patientId: record.patientId,
      createdAt: redeemedAt,
      lastUsedAt: redeemedAt,
      revokedAt: null,
    };
    writeStore(store);

    return {
      status: 'ok',
      accessToken,
      deviceId,
      patientId: record.patientId,
      displayName: patient.displayName,
      supportId: supportId(record.patientId),
    };
  }

  function enrolReusableReviewDevice({
    patientId = '',
    displayName = '',
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
    store.patients[id] = {
      patientId: id,
      displayName: name,
      createdAt: existing?.createdAt || enrolledAt,
      updatedAt: enrolledAt,
      reviewIdentity: true,
    };

    const accessToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = digest('device-token', accessToken);
    const deviceId = crypto.randomUUID();
    store.devices[tokenHash] = {
      deviceId,
      patientId: id,
      createdAt: enrolledAt,
      lastUsedAt: enrolledAt,
      revokedAt: null,
      reviewDevice: true,
    };
    writeStore(store);

    return {
      status: 'ok',
      accessToken,
      deviceId,
      patientId: id,
      displayName: name,
      supportId: supportId(id),
    };
  }

  function authenticate(accessToken) {
    const token = String(accessToken || '').trim();
    if (!token) return null;
    const store = readStore();
    const tokenHash = digest('device-token', token);
    const device = store.devices[tokenHash];
    if (!device || device.revokedAt) return null;

    const usedAt = now().toISOString();
    device.lastUsedAt = usedAt;
    writeStore(store);
    return {
      ...device,
      patient: store.patients[device.patientId] || null,
    };
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

  function snapshot() {
    return readStore();
  }

  return {
    identityPath,
    issueEnrolmentCode,
    redeemEnrolmentCode,
    enrolReusableReviewDevice,
    authenticate,
    revokePatientDevices,
    updatePatientDisplayName,
    snapshot,
  };
}

module.exports = {
  createIdentityStore,
  formatCode,
  normaliseCode,
  supportId,
};
