const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEventsStore } = require('../events_store');

test('only clinic-assigned Events can be recorded; removal keeps history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-events-'));
  try {
    const store = createEventsStore({ dataDir: dir, now: () => new Date('2026-09-29T01:00:00Z') });
    const infusion = store.saveDefinition({ label: 'Infusion', question: 'Infusion today?', type: 'daily' });
    const attack = store.saveDefinition({ label: 'Cluster headache attack', question: 'Record attack', type: 'timed' });
    const input = { eventId: infusion.id, occurredAt: '2026-09-29T00:00:00Z', localDate: '2026-09-29' };
    assert.throws(() => store.record('patient-a', input), /not assigned/);
    store.assign('patient-a', [infusion.id, attack.id]);
    store.record('patient-a', input);
    assert.throws(() => store.record('patient-a', input), /already been recorded/);
    store.record('patient-a', { ...input, eventId: attack.id });
    store.record('patient-a', { ...input, eventId: attack.id });
    assert.equal(store.entries('patient-a').length, 3);
    store.assign('patient-a', []);
    assert.deepEqual(store.assigned('patient-a'), []);
    assert.equal(store.entries('patient-a').length, 3);
    assert.throws(() => store.record('patient-a', { ...input, eventId: attack.id }), /not assigned/);
    assert.deepEqual(store.entries('patient-b'), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('custom intervals enforce exact boundaries, month ends, and backdating', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-events-'));
  try {
    let instant = new Date('2026-01-31T01:00:00Z');
    const store = createEventsStore({ dataDir: dir, now: () => instant });
    const monthly = store.saveDefinition({ label: 'Self-Injectable', type: 'timed', availabilityUnit: 'months', availabilityInterval: 1 });
    const botox = store.saveDefinition({ label: 'Botox', type: 'timed', availabilityUnit: 'days', availabilityInterval: 84 });
    store.assign('p', [monthly.id, botox.id]);
    const record = (event, date = instant) => store.record('p', { eventId: event.id, occurredAt: date.toISOString(), localDate: date.toISOString().slice(0, 10) });
    record(monthly); record(botox);
    assert.equal(store.assigned('p')[0].nextAvailableAt, '2026-02-28T01:00:00.000Z');
    assert.equal(store.assigned('p')[0].available, false);
    assert.throws(() => record(monthly), /available again/);
    instant = new Date('2026-02-28T00:59:59Z');
    assert.throws(() => record(monthly), /available again/);
    instant = new Date('2026-02-28T01:00:00Z');
    assert.equal(store.assigned('p')[0].available, true);
    assert.throws(() => record(monthly, new Date('2026-02-27T01:00:00Z')), /too close/);
    record(monthly);
    instant = new Date('2026-04-25T00:59:59Z');
    assert.throws(() => record(botox), /available again/);
    instant = new Date('2026-04-25T01:00:00Z');
    record(botox);
    store.assign('p', []); store.assign('p', [botox.id]);
    assert.equal(store.assigned('p')[0].available, false);
    store.assign('other', [botox.id]);
    assert.equal(store.assigned('other')[0].available, true);
    assert.throws(() => store.saveDefinition({ label: 'Invalid', type: 'timed', availabilityUnit: 'days', availabilityInterval: 1.5 }), /whole interval/);
    const updated = store.saveDefinition({ id: botox.id, label: 'Botox updated', type: 'timed' });
    assert.equal(updated.availabilityInterval, 84);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
