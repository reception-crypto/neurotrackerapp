'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const catalogVersion = 3;
const legacyCatalogVersion = 2;
const customDisorderMinimumBuild = 8;
const customSymptomMinimumBuild = 8;

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

function normaliseTerm(value, { label, minimum, maximum }) {
  const displayName = String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  if (displayName.length < minimum || displayName.length > maximum) {
    throw new Error(
      `The ${label} name must contain ${minimum} to ${maximum} characters.`,
    );
  }
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.'’(),/&+\-–:]*$/u.test(displayName)) {
    throw new Error(
      `The ${label} name contains unsupported punctuation or characters.`,
    );
  }
  return displayName;
}

function nameKey(value, normalise) {
  return normalise(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-AU')
    .replace(/[’']/g, "'")
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseDisorderName(value) {
  return normaliseTerm(value, {
    label: 'disorder',
    minimum: 3,
    maximum: 120,
  });
}

function disorderNameKey(value) {
  return nameKey(value, normaliseDisorderName);
}

function normaliseSymptomName(value) {
  return normaliseTerm(value, {
    label: 'symptom',
    minimum: 2,
    maximum: 80,
  });
}

function symptomNameKey(value) {
  return nameKey(value, normaliseSymptomName);
}

const symptomLabels = Object.freeze([
  ...new Set(Object.values(builtInSymptomCatalog).flat()),
]);
const symptomDefinitions = Object.freeze(symptomLabels.map(displayName =>
  Object.freeze({
    id: stableSlug(displayName),
    displayName,
    kind: 'built-in',
    active: true,
    minimumAppBuild: 7,
  })
));
const historicalSymptomDefinitions = Object.freeze([
  Object.freeze({
    id: 'visual-aura',
    displayName: 'Visual aura',
    kind: 'historical',
    active: false,
    minimumAppBuild: 7,
  }),
  Object.freeze({
    id: 'sweating-changes',
    displayName: 'Sweating changes',
    kind: 'historical',
    active: false,
    minimumAppBuild: 7,
  }),
]);
const staticSymptomDefinitions = Object.freeze([
  ...symptomDefinitions,
  ...historicalSymptomDefinitions,
]);
const staticSymptomsById = new Map(
  staticSymptomDefinitions.map(definition => [definition.id, definition]),
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
        symptoms.map(symptom => staticSymptomDefinitions.find(
          item => item.displayName === symptom,
        ).id),
      ),
    })
  ),
);
const builtInDisordersById = new Map(
  builtInDisorders.map(disorder => [disorder.id, disorder]),
);

function validActor(value) {
  const actor = String(value || '').trim();
  if (!actor || actor.length > 120 || /[\u0000-\u001f\u007f]/.test(actor)) {
    throw new Error('The catalogue audit actor is invalid.');
  }
  return actor;
}

function publicSymptom(record) {
  return {
    id: record.id,
    displayName: record.displayName,
    kind: record.kind,
    active: record.active !== false,
    minimumAppBuild: Number(record.minimumAppBuild || 7),
  };
}

function staticSymptomLookup() {
  return new Map(
    staticSymptomDefinitions.map(item => [item.id, publicSymptom(item)]),
  );
}

function publicDisorder(record, allowedSymptomIds, symptomLookup) {
  const availableIds = allowedSymptomIds.filter(id => {
    const symptom = symptomLookup.get(id);
    return symptom && symptom.active !== false && symptom.kind !== 'historical';
  });
  return {
    id: record.id,
    displayName: record.displayName,
    kind: record.kind,
    active: record.active !== false,
    minimumAppBuild: Number(record.minimumAppBuild || 7),
    allowedSymptomIds: availableIds,
    allowedSymptoms: availableIds.map(id => symptomLookup.get(id).displayName),
  };
}

function findDisorderFromDefinitions(
  definitions,
  { id = '', displayName = '' } = {},
) {
  const suppliedId = String(id || '').trim();
  const suppliedName = String(displayName || '').trim();
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

function findSymptomFromLookup(
  disorder,
  { id = '', displayName = '' } = {},
  symptomLookup,
) {
  if (!disorder) return null;
  const suppliedId = String(id || '').trim();
  const suppliedName = String(displayName || '').trim();
  let definition = suppliedId ? symptomLookup.get(suppliedId) || null : null;
  if (!definition && suppliedName) {
    const key = symptomNameKey(suppliedName);
    definition = [...symptomLookup.values()].find(
      item => symptomNameKey(item.displayName) === key,
    ) || null;
  }
  if (
    !definition ||
    definition.active === false ||
    definition.kind === 'historical' ||
    !disorder.allowedSymptomIds.includes(definition.id)
  ) {
    return null;
  }
  if (suppliedName && suppliedName !== definition.displayName) {
    throw new Error(
      'The symptom identifier does not match its registered display name.',
    );
  }
  return publicSymptom(definition);
}

function findGlobalSymptomFromLookup(
  { id = '', displayName = '' } = {},
  symptomLookup,
) {
  const suppliedId = String(id || '').trim();
  const suppliedName = String(displayName || '').trim();
  let definition = suppliedId ? symptomLookup.get(suppliedId) || null : null;
  if (!definition && suppliedName) {
    const key = symptomNameKey(suppliedName);
    definition = [...symptomLookup.values()].find(
      item => symptomNameKey(item.displayName) === key,
    ) || null;
  }
  if (!definition) return null;
  if (suppliedName && suppliedName !== definition.displayName) {
    throw new Error(
      'The symptom identifier does not match its registered display name.',
    );
  }
  return publicSymptom(definition);
}

function staticDisorderCatalog() {
  const symptomLookup = staticSymptomLookup();
  const definitions = builtInDisorders.map(disorder => publicDisorder(
    disorder,
    [...disorder.allowedSymptomIds],
    symptomLookup,
  ));
  return {
    version: catalogVersion,
    definitions: ({ includeInactive = false } = {}) => definitions.filter(
      item => includeInactive || item.active !== false,
    ),
    findDisorder: input => findDisorderFromDefinitions(definitions, input),
    findSymptom: (disorder, input) => findSymptomFromLookup(
      disorder,
      input,
      symptomLookup,
    ),
    findGlobalSymptom: input => findGlobalSymptomFromLookup(
      input,
      symptomLookup,
    ),
    symptomDefinitions: ({
      includeInactive = false,
      includeHistorical = false,
    } = {}) => [...symptomLookup.values()]
      .filter(item => includeInactive || item.active !== false)
      .filter(item => includeHistorical || item.kind !== 'historical')
      .map(publicSymptom),
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
      customSymptoms: {},
      builtInDisorderSymptomOverrides: {},
      symptomIdAliases: {},
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

  function validateV1Store(store) {
    if (
      Number(store.version) !== 1 ||
      !store.customDisorders ||
      typeof store.customDisorders !== 'object' ||
      !Array.isArray(store.auditLog)
    ) {
      throw new Error('The disorder catalogue schema is invalid.');
    }
    const nameKeys = new Set(
      builtInDisorders.map(item => disorderNameKey(item.displayName)),
    );
    const expectedSymptoms = symptomDefinitions.map(item => item.id);
    for (const [key, record] of Object.entries(store.customDisorders)) {
      if (!record || typeof record !== 'object' || record.id !== key) {
        throw new Error('The disorder catalogue contains an invalid record.');
      }
      if (!/^custom-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)) {
        throw new Error('The disorder catalogue contains an invalid identifier.');
      }
      const displayName = normaliseDisorderName(record.displayName);
      if (
        displayName !== record.displayName ||
        disorderNameKey(displayName) !== record.nameKey ||
        record.kind !== 'custom' ||
        typeof record.active !== 'boolean' ||
        Number(record.minimumAppBuild) !== customDisorderMinimumBuild ||
        !Array.isArray(record.allowedSymptomIds) ||
        record.allowedSymptomIds.length !== expectedSymptoms.length ||
        record.allowedSymptomIds.some((id, index) => id !== expectedSymptoms[index])
      ) {
        throw new Error('The disorder catalogue contains invalid symptoms.');
      }
      if (nameKeys.has(record.nameKey)) {
        throw new Error('The disorder catalogue contains a duplicate name.');
      }
      nameKeys.add(record.nameKey);
    }
  }

  function upgradeV1Store(store) {
    validateV1Store(store);
    const backupSuffix = now().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const backupPath = `${catalogPath}.backup-v1-${backupSuffix}-${randomUUID().slice(0, 8)}`;
    fs.copyFileSync(catalogPath, backupPath, fs.constants.COPYFILE_EXCL);
    const upgraded = {
      ...store,
      version: legacyCatalogVersion,
      customSymptoms: {},
      builtInDisorderSymptomOverrides: {},
    };
    writeStore(upgraded);
    return upgraded;
  }

  function symptomLookupFor(store) {
    const lookup = new Map([
      ...staticSymptomDefinitions.map(item => [item.id, publicSymptom(item)]),
      ...Object.values(store.customSymptoms || {}).map(
        item => [item.id, publicSymptom(item)],
      ),
    ]);
    for (const [legacyId, currentId] of Object.entries(
      store.symptomIdAliases || {},
    )) {
      const current = lookup.get(currentId);
      if (current) lookup.set(legacyId, current);
    }
    return lookup;
  }

  function uniqueSymptomsFromLookup(lookup) {
    const byCanonicalId = new Map();
    for (const symptom of lookup.values()) {
      byCanonicalId.set(symptom.id, symptom);
    }
    return [...byCanonicalId.values()];
  }

  function rawAllowedSymptomIds(store, disorder) {
    if (disorder.kind === 'built-in') {
      return store.builtInDisorderSymptomOverrides[disorder.id] ||
        [...disorder.allowedSymptomIds];
    }
    return [...disorder.allowedSymptomIds];
  }

  function definitionsFromStore(store, { includeInactive = false } = {}) {
    const symptomLookup = symptomLookupFor(store);
    const builtIn = builtInDisorders.map(disorder => publicDisorder(
      disorder,
      rawAllowedSymptomIds(store, disorder),
      symptomLookup,
    ));
    const custom = Object.values(store.customDisorders)
      .filter(record => includeInactive || record.active !== false)
      .map(record => publicDisorder(
        record,
        rawAllowedSymptomIds(store, record),
        symptomLookup,
      ))
      .sort((left, right) => left.displayName.localeCompare(
        right.displayName,
        'en-AU',
      ));
    return [...builtIn, ...custom];
  }

  function validateStoredSymptom(record, key, { legacyIdentifier = false } = {}) {
    if (!record || typeof record !== 'object' || record.id !== key) {
      throw new Error('The symptom catalogue contains an invalid record.');
    }
    const validIdentifier = legacyIdentifier
      ? /^custom-symptom-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)
      : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id) &&
        record.id.length <= 100;
    if (!validIdentifier) {
      throw new Error('The symptom catalogue contains an invalid identifier.');
    }
    const displayName = normaliseSymptomName(record.displayName);
    if (
      displayName !== record.displayName ||
      symptomNameKey(displayName) !== record.nameKey ||
      record.kind !== 'custom' ||
      typeof record.active !== 'boolean' ||
      Number(record.minimumAppBuild) !== customSymptomMinimumBuild
    ) {
      throw new Error('The symptom catalogue contains an invalid record.');
    }
  }

  function validateStoredDisorder(record, key, symptomLookup) {
    if (!record || typeof record !== 'object' || record.id !== key) {
      throw new Error('The disorder catalogue contains an invalid record.');
    }
    if (!/^custom-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)) {
      throw new Error('The disorder catalogue contains an invalid identifier.');
    }
    const displayName = normaliseDisorderName(record.displayName);
    if (
      displayName !== record.displayName ||
      disorderNameKey(displayName) !== record.nameKey ||
      record.kind !== 'custom' ||
      typeof record.active !== 'boolean' ||
      Number(record.minimumAppBuild) !== customDisorderMinimumBuild ||
      !Array.isArray(record.allowedSymptomIds) ||
      record.allowedSymptomIds.length < 3 ||
      new Set(record.allowedSymptomIds).size !== record.allowedSymptomIds.length ||
      record.allowedSymptomIds.some(id => {
        const symptom = symptomLookup.get(id);
        return !symptom || symptom.kind === 'historical';
      })
    ) {
      throw new Error('The disorder catalogue contains invalid symptoms.');
    }
  }

  function validateStore(store, {
    expectedVersion,
    legacySymptomIdentifiers = false,
  }) {
    if (
      Number(store.version) !== expectedVersion ||
      !store.customDisorders ||
      typeof store.customDisorders !== 'object' ||
      !store.customSymptoms ||
      typeof store.customSymptoms !== 'object' ||
      !store.builtInDisorderSymptomOverrides ||
      typeof store.builtInDisorderSymptomOverrides !== 'object' ||
      (!legacySymptomIdentifiers && (
        !store.symptomIdAliases ||
        typeof store.symptomIdAliases !== 'object'
      )) ||
      !Array.isArray(store.auditLog)
    ) {
      throw new Error('The disorder catalogue schema is invalid.');
    }

    const symptomKeys = new Set(
      staticSymptomDefinitions.map(item => symptomNameKey(item.displayName)),
    );
    for (const [key, record] of Object.entries(store.customSymptoms)) {
      if (!legacySymptomIdentifiers && staticSymptomsById.has(key)) {
        throw new Error('A custom symptom identifier collides with a built-in identifier.');
      }
      validateStoredSymptom(record, key, {
        legacyIdentifier: legacySymptomIdentifiers,
      });
      if (symptomKeys.has(record.nameKey)) {
        throw new Error('The symptom catalogue contains a duplicate name.');
      }
      symptomKeys.add(record.nameKey);
    }

    const symptomLookup = symptomLookupFor(store);
    const disorderKeys = new Set(
      builtInDisorders.map(item => disorderNameKey(item.displayName)),
    );
    for (const [key, record] of Object.entries(store.customDisorders)) {
      validateStoredDisorder(record, key, symptomLookup);
      if (disorderKeys.has(record.nameKey)) {
        throw new Error('The disorder catalogue contains a duplicate name.');
      }
      disorderKeys.add(record.nameKey);
    }

    for (const [disorderId, symptomIds] of Object.entries(
      store.builtInDisorderSymptomOverrides,
    )) {
      if (
        !builtInDisordersById.has(disorderId) ||
        !Array.isArray(symptomIds) ||
        symptomIds.length < 3 ||
        new Set(symptomIds).size !== symptomIds.length ||
        symptomIds.some(id => {
          const symptom = symptomLookup.get(id);
          return !symptom || symptom.kind === 'historical';
        })
      ) {
        throw new Error('A built-in disorder symptom override is invalid.');
      }
    }

    if (!legacySymptomIdentifiers) {
      for (const [legacyId, currentId] of Object.entries(
        store.symptomIdAliases,
      )) {
        if (
          !/^custom-symptom-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(legacyId) ||
          typeof currentId !== 'string' ||
          !store.customSymptoms[currentId] ||
          store.customSymptoms[legacyId]
        ) {
          throw new Error('The symptom identifier alias catalogue is invalid.');
        }
      }

      const legacyIds = new Set(Object.keys(store.symptomIdAliases));
      for (const symptomIds of Object.values(
        store.builtInDisorderSymptomOverrides,
      )) {
        if (symptomIds.some(id => legacyIds.has(id))) {
          throw new Error('A disorder still uses a legacy symptom identifier.');
        }
      }
      for (const disorder of Object.values(store.customDisorders)) {
        if (disorder.allowedSymptomIds.some(id => legacyIds.has(id))) {
          throw new Error('A disorder still uses a legacy symptom identifier.');
        }
      }
    }

    for (const disorder of [
      ...builtInDisorders,
      ...Object.values(store.customDisorders),
    ]) {
      const availableCount = rawAllowedSymptomIds(store, disorder)
        .filter(id => {
          const symptom = symptomLookup.get(id);
          return symptom && symptom.active !== false &&
            symptom.kind !== 'historical';
        }).length;
      if (availableCount < 3) {
        throw new Error(
          `${disorder.displayName} has fewer than three active symptoms.`,
        );
      }
    }
  }

  function validateV2Store(store) {
    validateStore(store, {
      expectedVersion: legacyCatalogVersion,
      legacySymptomIdentifiers: true,
    });
  }

  function validateCurrentStore(store) {
    validateStore(store, {
      expectedVersion: catalogVersion,
      legacySymptomIdentifiers: false,
    });
  }

  function readableSymptomId(store, displayName, legacyId = '') {
    const base = stableSlug(displayName) || 'symptom';
    const occupied = new Set([
      ...staticSymptomDefinitions.map(item => item.id),
      ...Object.keys(store.customSymptoms || {})
        .filter(id => id !== legacyId),
    ]);
    if (!occupied.has(base)) return base;

    const legacySuffix = String(legacyId)
      .replace(/^custom-symptom-/i, '')
      .replace(/-/g, '')
      .slice(0, 8)
      .toLowerCase();
    let suffix = legacySuffix || randomUUID().replace(/-/g, '').slice(0, 8);
    let candidate = `${base}-${suffix}`;
    while (occupied.has(candidate)) {
      suffix = randomUUID().replace(/-/g, '').slice(0, 8).toLowerCase();
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  function activeClinicalReference(legacyId) {
    for (const filename of ['identity_store.json', 'symptom_entries.csv']) {
      const filePath = path.join(dataDir, filename);
      if (
        fs.existsSync(filePath) &&
        fs.readFileSync(filePath, 'utf8').includes(legacyId)
      ) {
        return filename;
      }
    }
    return null;
  }

  function replaceSymptomIds(ids, mappings) {
    return (ids || []).map(id => mappings.get(id) || id);
  }

  function upgradeV2Store(store) {
    validateV2Store(store);
    const mappings = new Map();
    const reservedStore = {
      ...store,
      customSymptoms: { ...store.customSymptoms },
    };
    for (const record of Object.values(store.customSymptoms)) {
      const reference = activeClinicalReference(record.id);
      if (reference) {
        throw new Error(
          `Custom symptom ${record.displayName} already has an active ` +
          `clinical reference in ${reference}; its canonical identifier ` +
          'was not changed.',
        );
      }
      const readableId = readableSymptomId(
        reservedStore,
        record.displayName,
        record.id,
      );
      mappings.set(record.id, readableId);
      delete reservedStore.customSymptoms[record.id];
      reservedStore.customSymptoms[readableId] = {
        ...record,
        id: readableId,
      };
    }

    const backupSuffix = now().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const backupPath = `${catalogPath}.backup-v2-${backupSuffix}-${randomUUID().slice(0, 8)}`;
    fs.copyFileSync(catalogPath, backupPath, fs.constants.COPYFILE_EXCL);

    const upgradedSymptoms = {};
    for (const [legacyId, record] of Object.entries(store.customSymptoms)) {
      const readableId = mappings.get(legacyId);
      upgradedSymptoms[readableId] = { ...record, id: readableId };
    }
    store.customSymptoms = upgradedSymptoms;
    for (const [disorderId, symptomIds] of Object.entries(
      store.builtInDisorderSymptomOverrides,
    )) {
      store.builtInDisorderSymptomOverrides[disorderId] =
        replaceSymptomIds(symptomIds, mappings);
    }
    for (const disorder of Object.values(store.customDisorders)) {
      disorder.allowedSymptomIds = replaceSymptomIds(
        disorder.allowedSymptomIds,
        mappings,
      );
    }
    store.symptomIdAliases = Object.fromEntries(mappings);
    store.version = catalogVersion;
    for (const [legacyId, readableId] of mappings) {
      const record = store.customSymptoms[readableId];
      audit(store, {
        actor: 'system-catalogue-migration',
        action: 'custom_symptom_identifier_migrated',
        symptomId: readableId,
        before: { id: legacyId, displayName: record.displayName },
        after: { id: readableId, displayName: record.displayName },
      });
    }
    validateCurrentStore(store);
    writeStore(store);
    return store;
  }

  function readStore() {
    ensureStore();
    let parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (Number(parsed.version) === 1) parsed = upgradeV1Store(parsed);
    if (Number(parsed.version) === legacyCatalogVersion) {
      parsed = upgradeV2Store(parsed);
    }
    validateCurrentStore(parsed);
    return parsed;
  }

  function allDisorderNameKeys(store, exceptId = '') {
    const keys = new Set(
      builtInDisorders.map(item => disorderNameKey(item.displayName)),
    );
    for (const record of Object.values(store.customDisorders)) {
      if (record.id !== exceptId) keys.add(record.nameKey);
    }
    return keys;
  }

  function allSymptomNameKeys(store, exceptId = '') {
    const keys = new Set(
      staticSymptomDefinitions.map(item => symptomNameKey(item.displayName)),
    );
    for (const record of Object.values(store.customSymptoms)) {
      if (record.id !== exceptId) keys.add(record.nameKey);
    }
    return keys;
  }

  function audit(store, {
    actor,
    action,
    disorderId = null,
    symptomId = null,
    before,
    after,
  }) {
    store.auditLog.push({
      eventId: randomUUID(),
      at: now().toISOString(),
      actor: validActor(actor),
      action,
      disorderId,
      symptomId,
      before,
      after,
    });
  }

  function disorderAuditSnapshot(record) {
    if (!record) return null;
    return {
      displayName: record.displayName,
      active: record.active !== false,
      allowedSymptomIds: [...record.allowedSymptomIds],
    };
  }

  function symptomAuditSnapshot(record) {
    if (!record) return null;
    return {
      displayName: record.displayName,
      active: record.active !== false,
    };
  }

  function activeAssignableSymptoms(store) {
    return uniqueSymptomsFromLookup(symptomLookupFor(store))
      .filter(item => item.active !== false && item.kind !== 'historical')
      .sort((left, right) => left.displayName.localeCompare(
        right.displayName,
        'en-AU',
      ));
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
    if (allDisorderNameKeys(store).has(nameKey)) {
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
      allowedSymptomIds: activeAssignableSymptoms(store).map(item => item.id),
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
      after: disorderAuditSnapshot(record),
    });
    validateCurrentStore(store);
    writeStore(store);
    return publicDisorder(record, record.allowedSymptomIds, symptomLookupFor(store));
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
    const before = disorderAuditSnapshot(record);
    let action = 'custom_disorder_updated';

    if (displayName != null || confirmation != null) {
      const name = normaliseDisorderName(displayName);
      const confirmedName = normaliseDisorderName(confirmation);
      if (name !== confirmedName) {
        throw new Error('The two disorder-name entries must match exactly.');
      }
      const newNameKey = disorderNameKey(name);
      if (allDisorderNameKeys(store, record.id).has(newNameKey)) {
        throw new Error('That disorder already exists in the catalogue.');
      }
      record.displayName = name;
      record.nameKey = newNameKey;
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
      after: disorderAuditSnapshot(record),
    });
    validateCurrentStore(store);
    writeStore(store);
    return publicDisorder(record, record.allowedSymptomIds, symptomLookupFor(store));
  }

  function createCustomSymptom({
    displayName,
    confirmation,
    actor = 'clinic-admin',
  } = {}) {
    const name = normaliseSymptomName(displayName);
    const confirmedName = normaliseSymptomName(confirmation);
    if (name !== confirmedName) {
      throw new Error('The two symptom-name entries must match exactly.');
    }
    const store = readStore();
    const newNameKey = symptomNameKey(name);
    if (allSymptomNameKeys(store).has(newNameKey)) {
      throw new Error('That symptom already exists in the catalogue.');
    }
    const id = readableSymptomId(store, name);
    const timestamp = now().toISOString();
    const record = {
      id,
      displayName: name,
      nameKey: newNameKey,
      kind: 'custom',
      active: true,
      minimumAppBuild: customSymptomMinimumBuild,
      createdAt: timestamp,
      createdBy: validActor(actor),
      updatedAt: timestamp,
      updatedBy: validActor(actor),
    };
    store.customSymptoms[id] = record;
    audit(store, {
      actor,
      action: 'custom_symptom_created',
      symptomId: id,
      before: null,
      after: symptomAuditSnapshot(record),
    });
    validateCurrentStore(store);
    writeStore(store);
    return publicSymptom(record);
  }

  function updateCustomSymptom({
    id,
    displayName,
    confirmation,
    active,
    actor = 'clinic-admin',
  } = {}) {
    const store = readStore();
    const record = store.customSymptoms[String(id || '').trim()];
    if (!record) throw new Error('The custom symptom was not found.');
    const before = symptomAuditSnapshot(record);
    let action = 'custom_symptom_updated';

    if (displayName != null || confirmation != null) {
      const name = normaliseSymptomName(displayName);
      const confirmedName = normaliseSymptomName(confirmation);
      if (name !== confirmedName) {
        throw new Error('The two symptom-name entries must match exactly.');
      }
      const newNameKey = symptomNameKey(name);
      if (allSymptomNameKeys(store, record.id).has(newNameKey)) {
        throw new Error('That symptom already exists in the catalogue.');
      }
      record.displayName = name;
      record.nameKey = newNameKey;
    }

    if (typeof active === 'boolean' && active !== record.active) {
      record.active = active;
      action = active
        ? 'custom_symptom_reactivated'
        : 'custom_symptom_archived';
    }
    record.updatedAt = now().toISOString();
    record.updatedBy = validActor(actor);
    audit(store, {
      actor,
      action,
      symptomId: record.id,
      before,
      after: symptomAuditSnapshot(record),
    });
    validateCurrentStore(store);
    writeStore(store);
    return publicSymptom(record);
  }

  function setDisorderSymptoms({
    disorderId,
    symptomIds = [],
    actor = 'clinic-admin',
  } = {}) {
    const store = readStore();
    const id = String(disorderId || '').trim();
    const source = builtInDisordersById.get(id) || store.customDisorders[id];
    if (!source) throw new Error('The disorder was not found.');
    const submittedIds = [...new Set(
      (Array.isArray(symptomIds) ? symptomIds : [symptomIds])
        .map(value => String(value || '').trim())
        .filter(Boolean),
    )];
    if (submittedIds.length < 3) {
      throw new Error('Each disorder must offer at least three symptoms.');
    }
    const symptomLookup = symptomLookupFor(store);
    const selectedIds = [];
    for (const symptomId of submittedIds) {
      const symptom = symptomLookup.get(symptomId);
      if (!symptom || symptom.active === false || symptom.kind === 'historical') {
        throw new Error('Only active catalogue symptoms can be made available.');
      }
      selectedIds.push(symptom.id);
    }
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new Error(
        'The same symptom cannot be selected through both a current and ' +
        'legacy identifier.',
      );
    }
    const beforeIds = rawAllowedSymptomIds(store, source);
    if (JSON.stringify(beforeIds) === JSON.stringify(selectedIds)) {
      return publicDisorder(source, beforeIds, symptomLookup);
    }
    if (source.kind === 'built-in') {
      store.builtInDisorderSymptomOverrides[id] = selectedIds;
    } else {
      source.allowedSymptomIds = selectedIds;
      source.updatedAt = now().toISOString();
      source.updatedBy = validActor(actor);
    }
    audit(store, {
      actor,
      action: 'disorder_symptoms_updated',
      disorderId: id,
      before: { allowedSymptomIds: beforeIds },
      after: { allowedSymptomIds: selectedIds },
    });
    validateCurrentStore(store);
    writeStore(store);
    return publicDisorder(source, selectedIds, symptomLookupFor(store));
  }

  function definitions(options) {
    return definitionsFromStore(readStore(), options);
  }

  function resolveDisorder(input = {}) {
    const store = readStore();
    const definitions = definitionsFromStore(store, {
      includeInactive: input.includeInactive !== false,
    });
    return findDisorderFromDefinitions(definitions, input);
  }

  function resolveSymptom(disorder, input = {}) {
    const store = readStore();
    return findSymptomFromLookup(disorder, input, symptomLookupFor(store));
  }

  function resolveGlobalSymptom(input = {}) {
    const store = readStore();
    return findGlobalSymptomFromLookup(input, symptomLookupFor(store));
  }

  function listSymptoms({
    includeInactive = false,
    includeHistorical = false,
  } = {}) {
    const store = readStore();
    return uniqueSymptomsFromLookup(symptomLookupFor(store))
      .filter(item => includeInactive || item.active !== false)
      .filter(item => includeHistorical || item.kind !== 'historical')
      .sort((left, right) => left.displayName.localeCompare(
        right.displayName,
        'en-AU',
      ))
      .map(publicSymptom);
  }

  function snapshot() {
    return readStore();
  }

  return {
    version: catalogVersion,
    catalogPath,
    createCustomDisorder,
    updateCustomDisorder,
    createCustomSymptom,
    updateCustomSymptom,
    setDisorderSymptoms,
    definitions,
    findDisorder: resolveDisorder,
    findSymptom: resolveSymptom,
    findGlobalSymptom: resolveGlobalSymptom,
    symptomDefinitions: listSymptoms,
    snapshot,
  };
}

module.exports = {
  builtInDisorders,
  builtInSymptomCatalog,
  catalogVersion,
  createDisorderCatalogStore,
  customDisorderMinimumBuild,
  customSymptomMinimumBuild,
  disorderNameKey,
  normaliseDisorderName,
  normaliseSymptomName,
  staticDisorderCatalog: staticDisorderCatalog(),
  symptomDefinitions,
  symptomNameKey,
};
