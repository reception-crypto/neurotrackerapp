const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const schemaVersion = 1;
const permissionDefinitions = Object.freeze([
  { id: 'patient_review', label: 'Patient review' },
  { id: 'population_analytics', label: 'Population analytics' },
  { id: 'enrolments', label: 'Enrolments' },
  { id: 'disorders_symptoms', label: 'Disorders and symptoms' },
  { id: 'identity_recovery', label: 'Identity recovery' },
  { id: 'manage_patients', label: 'Manage patients' },
  { id: 'csv_export', label: 'CSV export' },
]);
const permissionIds = new Set(permissionDefinitions.map(item => item.id));
const drPascoePermissions = Object.freeze([
  'patient_review',
  'population_analytics',
  'enrolments',
  'disorders_symptoms',
]);

function canonicalUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('en-AU');
}

function validUsername(value) {
  const username = String(value || '').trim();
  return username.length >= 2 && username.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(username);
}

function normalisePermissions(values) {
  const supplied = Array.isArray(values) ? values : [values];
  return [...new Set(supplied.map(String).filter(value => permissionIds.has(value)))];
}

function passwordDigest(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 &&
    password.length <= 1024;
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function emptyState() {
  return { schemaVersion, users: {} };
}

function createPortalUserStore({ dataDir }) {
  if (!dataDir) throw new Error('Portal user storage requires a data directory.');
  const userPath = path.join(dataDir, 'portal_users.json');

  function read() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(userPath)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(userPath, 'utf8'));
    if (parsed?.schemaVersion !== schemaVersion || !parsed.users ||
        typeof parsed.users !== 'object' || Array.isArray(parsed.users)) {
      throw new Error('The clinician portal user file is invalid.');
    }
    return parsed;
  }

  function write(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temporaryPath = `${userPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, userPath);
    try { fs.chmodSync(userPath, 0o600); } catch (_) { /* Windows ACLs apply. */ }
  }

  function publicUser(record) {
    return {
      username: record.username,
      permissions: normalisePermissions(record.permissions),
      active: record.active !== false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  function list() {
    return Object.values(read().users)
      .map(publicUser)
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  function get(username) {
    const record = read().users[canonicalUsername(username)];
    return record ? publicUser(record) : null;
  }

  function save({ username, password, permissions, active = true }) {
    const displayUsername = String(username || '').trim();
    if (!validUsername(displayUsername)) {
      throw new Error('Username must contain between 2 and 80 printable characters.');
    }
    if (canonicalUsername(displayUsername) === 'admin') {
      throw new Error('The protected admin account cannot be replaced.');
    }
    const state = read();
    const key = canonicalUsername(displayUsername);
    const existing = state.users[key];
    if (!existing && !validPassword(password)) {
      throw new Error('New user passwords must be at least 12 characters.');
    }
    if (password && !validPassword(password)) {
      throw new Error('Passwords must be at least 12 characters.');
    }
    const now = new Date().toISOString();
    const salt = password ? crypto.randomBytes(16).toString('hex') : existing.salt;
    state.users[key] = {
      username: displayUsername,
      salt,
      passwordHash: password ? passwordDigest(password, salt) : existing.passwordHash,
      permissions: normalisePermissions(permissions),
      active: active !== false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    write(state);
    return publicUser(state.users[key]);
  }

  function remove(username) {
    const state = read();
    const key = canonicalUsername(username);
    if (!state.users[key]) return false;
    delete state.users[key];
    write(state);
    return true;
  }

  function authenticate(username, password) {
    const record = read().users[canonicalUsername(username)];
    if (!record || record.active === false || !record.salt || !record.passwordHash) {
      return null;
    }
    const suppliedHash = passwordDigest(String(password || ''), record.salt);
    return safeEqualText(suppliedHash, record.passwordHash)
      ? publicUser(record)
      : null;
  }

  return { authenticate, get, list, remove, save, userPath };
}

module.exports = {
  createPortalUserStore,
  drPascoePermissions,
  permissionDefinitions,
};
