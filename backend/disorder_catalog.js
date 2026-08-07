'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const catalogVersion = 1;
const customDisorderMinimumBuild = 8;

const builtInSymptomCatalog = Object.freeze({
  Migraine: Object.freeze([
    'Headache',
    'Nausea',
    'Vomiting',
    'Light sensitivity',
    'Sound sensitivity',
    'Vertigo',
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

const builtInDisorderIds = Object.freeze({
  Migraine: 'migraine',
  Dysautonomia: 'dysautonomia',
  CIDP: 'cidp',
  'Myasthenia Gravis': 'myasthenia-gravis',
});

function stableSlug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const symptomLabels = Object.freeze([
  ...new Set(Object.values(builtInSymptomCatalog).flat()),
]);
const symptomDefinitions = Object.freeze(symptomLabels.map(displayName =>
  Object.freeze({
    id: stableSlug(displayName),
    displayName,
  })
));
const historicalSymptomDefinitions = Object.freeze([
  Object.freeze({
    id: 'visual-aura',
    displayName: 'Visual aura',
  }),
  Object.freeze({
    id: 'sweating-changes',
    displayName: 'Sweating changes',
  }),
]);
const allSymptomDefinitions = Object.freeze([
  ...symptomDefinitions,
  ...historicalSymptomDefinitions,
]);
const symptomsById = new Map(
  allSymptomDefinitions.map(definition => [definition.id, definition]),
);
const symptomsByName = new Map(
  allSymptomDefinitions.map(definition => [
    definition.displayName.toLocaleLowerCase('en-AU'),
    definition,
  ]),
);

const builtInDisorders = Object.freeze(
  Object.entries(builtInSymptomCatalog).map(([displayName, symptoms]) =>
    Object.freeze({
      id: builtInDisorderIds[displayName],
      displayName,
      kind: 'built-in',
      active: true,
      minimumAppBuild: 7,
      allowedSymptomIds: Object.freeze(
        symptoms.map(symptom => symptomsByName.get(
          symptom.toLocaleLowerCase('en-AU'),
        ).id),
      ),
    })
  ),
);

function normaliseDisorderName(value) {
  const displayName = String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  if (displayName.length < 3 || displayName.length > 120) {
    throw new Error('The disorder name must contain 3 to 120 characters.');
  }
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.'’(),/&+\-–:]*$/u.test(displayName)) {
    throw new Error(
      'The disorder name contains unsupported punctuation or characters.',
    );
  }
  return displayName;
}

function disorderNameKey(value) {
  return normaliseDisorderName(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-AU')
    .replace(/[’']/g, "'")
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function validActor(value) {
  const actor = String(value || '').trim();
  if (!actor || actor.length > 120 || /[\u0000-\u001f\u007f]/.test(actor)) {
    throw new Error('The catalogue audit actor is invalid.');
  }
  return actor;
}

function publicDisorder(record) {
  return {
    id: record.id,
    displayName: record.displayName,
    kind: record.kind,
    active: record.active !== false,
    minimumAppBuild: Number(record.minimumAppBuild || 7),
    allowedSymptomIds: [...record.allowedSymptomIds],
    allowedSymptoms: record.allowedSymptomIds.map(
      symptomId => symptomsById.get(symptomId).displayName,
    ),
  };
}

function definitionsFrom(customDisorders = {}, { includeInactive = false } = {}) {
  const custom = Object.values(customDisorders)
    .filter(record => includeInactive || record.active !== false)
    .map(publicDisorder)
    .sort((left, right) => left.displayName.localeCompare(
      right.displayName,
      'en-AU',
    ));
  return [
    ...builtInDisorders.map(publicDisorder),
    ...custom,
  ];
}

function findDisorder(
  customDisorders,
  { id = '', displayName = '', includeInactive = true } = {},
) {
  const suppliedId = String(id || '').trim();
  const suppliedName = String(displayName || '').trim();
  const definitions = definitionsFrom(customDisorders, { includeInactive });
  let definition = null;
  if (suppliedId) {
    definition = definitions.find(item => item.id === suppliedId) || null;
  } else if (suppliedName) {
    const key = disorderNameKey(suppliedName);
    definition = definitions.find(
      item => disorderNameKey(item.displayName) === key,
    ) || null;
  }
  if (!definition) return null;
  if (
    suppliedName &&
    disorderNameKey(suppliedName) !== disorderNameKey(definition.displayName)
  ) {
    throw new Error(
      'The disorder identifier does not match its registered display name.',
    );
  }
  return definition;
}

function findSymptom(
  disorder,
  { id = '', displayName = '' } = {},
) {
  if (!disorder) return null;
  const suppliedId = String(id || '').trim();
  const suppliedName = String(displayName || '').trim();
  let definition = null;
  if (suppliedId) {
    definition = symptomsById.get(suppliedId) || null;
  } else if (suppliedName) {
    definition = symptomsByName.get(
      suppliedName.toLocaleLowerCase('en-AU'),
    ) || null;
  }
  if (!definition || !disorder.allowedSymptomIds.includes(definition.id)) {
    return null;
  }
  if (suppliedName && suppliedName !== definition.displayName) {
    throw new Error(
      'The symptom identifier does not match its registered display name.',
    );
  }
  return { ...definition };
}

function findGlobalSymptom({ id = '', displayName = '' } = {}) {
  const suppliedId = String(id || '').trim();
  const suppliedName = String(displayName || '').trim();
  const definition = suppliedId
    ? symptomsById.get(suppliedId) || null
    : symptomsByName.get(suppliedName.toLocaleLowerCase('en-AU')) || null;
  if (!definition) return null;
  if (suppliedName && suppliedName !== definition.displayName) {
    throw new Error(
      'The symptom identifier does not match its registered display name.',
    );
  }
  return { ...definition };
}

function staticDisorderCatalog() {
  const customDisorders = {};
  return {
    version: catalogVersion,
    definitions: options => definitionsFrom(customDisorders, options),
    findDisorder: input => findDisorder(customDisorders, input),
    findSymptom,
    findGlobalSymptom,
    symptomDefinitions: () => symptomDefinitions.map(item => ({ ...item })),
  };
}

function createDisorderCatalogStore({
  dataDir,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  if (!dataDir) throw new Error('A disorder catalogue data directory is required.');
  const catalogPath = path.join(dataDir, 'disorder_catalog.json');

  function emptyStore() {
    return {
      version: catalogVersion,
      customDisorders: {},
      auditLog: [],
    };
  }

  function writeStore(store) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temporaryPath = `${catalogPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, catalogPath);
  }

  function ensureStore() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(catalogPath)) writeStore(emptyStore());
  }

  function validateStoredDisorder(record, key) {
    if (!record || typeof record !== 'object' || record.id !== key) {
      throw new Error('The disorder catalogue contains an invalid record.');
    }
    if (!/^custom-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)) {
      throw new Error('The disorder catalogue contains an invalid identifier.');
    }
    const displayName = normaliseDisorderName(record.displayName);
    if (
      displayName !== record.displayName ||
      disorderNameKey(displayName) !== record.nameKey
    ) {
      throw new Error('The disorder catalogue contains an invalid name index.');
    }
    if (
      record.kind !== 'custom' ||
      typeof record.active !== 'boolean' ||
      Number(record.minimumAppBuild) !== customDisorderMinimumBuild ||
      !Array.isArray(record.allowedSymptomIds) ||
      record.allowedSymptomIds.length !== symptomDefinitions.length ||
      new Set(record.allowedSymptomIds).size !== record.allowedSymptomIds.length ||
      record.allowedSymptomIds.some(
        (id, index) => id !== symptomDefinitions[index].id,
      )
    ) {
      throw new Error('The disorder catalogue contains invalid symptoms.');
    }
  }

  function readStore() {
    ensureStore();
    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (
      Number(parsed.version) !== catalogVersion ||
      !parsed.customDisorders ||
      typeof parsed.customDisorders !== 'object' ||
      !Array.isArray(parsed.auditLog)
    ) {
      throw new Error('The disorder catalogue schema is invalid.');
    }
    const nameKeys = new Set(
      builtInDisorders.map(item => disorderNameKey(item.displayName)),
    );
    for (const [key, record] of Object.entries(parsed.customDisorders)) {
      validateStoredDisorder(record, key);
      if (nameKeys.has(record.nameKey)) {
        throw new Error('The disorder catalogue contains a duplicate name.');
      }
      nameKeys.add(record.nameKey);
    }
    return parsed;
  }

  function allNameKeys(store, exceptId = '') {
    const keys = new Set(
      builtInDisorders.map(item => disorderNameKey(item.displayName)),
    );
    for (const record of Object.values(store.customDisorders)) {
      if (record.id !== exceptId) keys.add(record.nameKey);
    }
    return keys;
  }

  function audit(store, { actor, action, disorderId, before, after }) {
    store.auditLog.push({
      eventId: randomUUID(),
      at: now().toISOString(),
      actor: validActor(actor),
      action,
      disorderId,
      before,
      after,
    });
  }

  function auditSnapshot(record) {
    if (!record) return null;
    return {
      displayName: record.displayName,
      active: record.active !== false,
    };
  }

  function createCustomDisorder({
    displayName,
    confirmation,
    actor = 'clinic-admin',
  } = {}) {
    const name = normaliseDisorderName(displayName);
    const confirmedName = normaliseDisorderName(confirmation);
    if (name !== confirmedName) {
      throw new Error('The two disorder-name entries must match exactly.');
    }
    const store = readStore();
    const nameKey = disorderNameKey(name);
    if (allNameKeys(store).has(nameKey)) {
      throw new Error('That disorder already exists in the catalogue.');
    }
    const id = `custom-${randomUUID()}`;
    const timestamp = now().toISOString();
    const record = {
      id,
      displayName: name,
      nameKey,
      kind: 'custom',
      active: true,
      minimumAppBuild: customDisorderMinimumBuild,
      allowedSymptomIds: symptomDefinitions.map(item => item.id),
      createdAt: timestamp,
      createdBy: validActor(actor),
      updatedAt: timestamp,
      updatedBy: validActor(actor),
    };
    store.customDisorders[id] = record;
    audit(store, {
      actor,
      action: 'custom_disorder_created',
      disorderId: id,
      before: null,
      after: auditSnapshot(record),
    });
    writeStore(store);
    return publicDisorder(record);
  }

  function updateCustomDisorder({
    id,
    displayName,
    confirmation,
    active,
    actor = 'clinic-admin',
  } = {}) {
    const store = readStore();
    const record = store.customDisorders[String(id || '').trim()];
    if (!record) throw new Error('The custom disorder was not found.');
    const before = auditSnapshot(record);
    let action = 'custom_disorder_updated';

    if (displayName != null || confirmation != null) {
      const name = normaliseDisorderName(displayName);
      const confirmedName = normaliseDisorderName(confirmation);
      if (name !== confirmedName) {
        throw new Error('The two disorder-name entries must match exactly.');
      }
      const nameKey = disorderNameKey(name);
      if (allNameKeys(store, record.id).has(nameKey)) {
        throw new Error('That disorder already exists in the catalogue.');
      }
      record.displayName = name;
      record.nameKey = nameKey;
    }

    if (typeof active === 'boolean' && active !== record.active) {
      record.active = active;
      action = active
        ? 'custom_disorder_reactivated'
        : 'custom_disorder_archived';
    }
    record.updatedAt = now().toISOString();
    record.updatedBy = validActor(actor);
    audit(store, {
      actor,
      action,
      disorderId: record.id,
      before,
      after: auditSnapshot(record),
    });
    writeStore(store);
    return publicDisorder(record);
  }

  function definitions(options) {
    return definitionsFrom(readStore().customDisorders, options);
  }

  function resolveDisorder(input = {}) {
    return findDisorder(readStore().customDisorders, input);
  }

  function snapshot() {
    return readStore();
  }

  return {
    version: catalogVersion,
    catalogPath,
    createCustomDisorder,
    updateCustomDisorder,
    definitions,
    findDisorder: resolveDisorder,
    findSymptom,
    findGlobalSymptom,
    symptomDefinitions: () => symptomDefinitions.map(item => ({ ...item })),
    snapshot,
  };
}

module.exports = {
  builtInDisorders,
  builtInSymptomCatalog,
  catalogVersion,
  createDisorderCatalogStore,
  customDisorderMinimumBuild,
  disorderNameKey,
  normaliseDisorderName,
  staticDisorderCatalog: staticDisorderCatalog(),
  symptomDefinitions,
};
