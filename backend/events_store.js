const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createEventsStore({ dataDir, now = () => new Date() }) {
  const file = path.join(dataDir, 'events.json');
  const blank = () => ({ version: 1, definitions: {}, assignments: {}, entries: [] });
  function read() {
    if (!fs.existsSync(file)) return blank();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...blank(), ...data };
  }
  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function definitions() { return Object.values(read().definitions); }
  function nextDate(event, occurrence) {
    const date = new Date(occurrence);
    if (event.availabilityUnit === 'months') {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + event.availabilityInterval);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
    } else date.setUTCDate(date.getUTCDate() + event.availabilityInterval);
    return date;
  }
  function assigned(patientId) {
    const data = read();
    return (data.assignments[patientId] || [])
      .map(id => data.definitions[id]).filter(item => item?.active).map(event => {
        const latest = data.entries.filter(entry => entry.patientId === patientId && entry.eventId === event.id)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
        const next = event.availabilityInterval && latest ? nextDate(event, latest.occurredAt) : null;
        return { ...event, available: !next || now() >= next, nextAvailableAt: next?.toISOString() || null };
      });
  }
  function saveDefinition({ id, label, question, type, availabilityUnit, availabilityInterval }) {
    label = String(label || '').trim();
    question = String(question || label).trim();
    if (!label || label.length > 80 || !question || question.length > 160 ||
        !['daily', 'timed'].includes(type)) {
      throw new Error('Provide a label and valid Event type.');
    }
    const data = read();
    if (id && !data.definitions[id]) throw new Error('Event not found.');
    const eventId = id || crypto.randomUUID();
    const previous = data.definitions[eventId];
    availabilityUnit = availabilityUnit ?? previous?.availabilityUnit ?? 'none';
    availabilityInterval = availabilityUnit === 'none' ? 0 : Number(availabilityInterval ?? previous?.availabilityInterval);
    if (!['none', 'days', 'months'].includes(availabilityUnit) ||
        (availabilityUnit !== 'none' && (!Number.isInteger(availabilityInterval) || availabilityInterval < 1 || availabilityInterval > 3650))) {
      throw new Error('Choose an availability unit and a whole interval from 1 to 3650.');
    }
    if (previous && previous.type !== type && data.entries.some(entry => entry.eventId === eventId)) {
      throw new Error('The type of an Event with recorded entries cannot change.');
    }
    data.definitions[eventId] = { id: eventId, label, question, type, availabilityUnit, availabilityInterval, active: previous?.active ?? true };
    write(data);
    return data.definitions[eventId];
  }
  function setActive(id, active) {
    const data = read();
    if (!data.definitions[id]) throw new Error('Event not found.');
    data.definitions[id].active = Boolean(active);
    write(data);
  }
  function assign(patientId, eventIds) {
    const data = read();
    const ids = [...new Set(eventIds)];
    if (ids.some(id => !data.definitions[id]?.active)) throw new Error('Unknown or archived Event.');
    data.assignments[patientId] = ids;
    write(data);
  }
  function entries(patientId) {
    return read().entries.filter(entry => entry.patientId === patientId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  function record(patientId, input, utcOffsetMinutes = 0) {
    const data = read();
    const event = data.definitions[String(input.eventId || '')];
    if (!event?.active || !(data.assignments[patientId] || []).includes(event.id)) {
      throw new Error('This Event is not assigned to this patient.');
    }
    const occurredAt = String(input.occurredAt || '');
    const date = new Date(occurredAt);
    const instant = now();
    if (!/^\d{4}-\d\d-\d\dT/.test(occurredAt) || !Number.isFinite(date.getTime()) ||
        date.getTime() > instant.getTime() + 5 * 60 * 1000 ||
        date.getTime() < instant.getTime() - 8 * 86400000) {
      throw new Error('Choose a valid Event time within the last seven days.');
    }
    const localDate = String(input.localDate || '');
    if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 840 ||
        localDate !== new Date(date.getTime() + utcOffsetMinutes * 60000).toISOString().slice(0, 10)) {
      throw new Error('The Event date does not match its time.');
    }
    if (event.type === 'daily' && data.entries.some(entry =>
      entry.patientId === patientId && entry.eventId === event.id && entry.localDate === localDate)) {
      throw new Error('This Event has already been recorded for that day.');
    }
    if (event.availabilityInterval) {
      const history = data.entries.filter(entry => entry.patientId === patientId && entry.eventId === event.id);
      const latest = history.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
      if (latest && instant < nextDate(event, latest.occurredAt)) {
        throw new Error(`This Event is available again on ${nextDate(event, latest.occurredAt).toISOString()}.`);
      }
      if (history.some(entry => {
        const existing = new Date(entry.occurredAt);
        return date >= existing ? date < nextDate(event, existing) : existing < nextDate(event, date);
      })) throw new Error('The Event time is too close to another recorded occurrence.');
    }
    const entry = {
      id: crypto.randomUUID(), patientId, eventId: event.id,
      label: event.label, type: event.type, localDate,
      occurredAt: date.toISOString(), submittedAt: instant.toISOString(),
    };
    data.entries.push(entry);
    write(data);
    return entry;
  }
  function removePatient(patientId) {
    const data = read();
    delete data.assignments[patientId];
    data.entries = data.entries.filter(entry => entry.patientId !== patientId);
    write(data);
  }
  return { file, definitions, assigned, saveDefinition, setActive, assign, entries, record, removePatient };
}

module.exports = { createEventsStore };
