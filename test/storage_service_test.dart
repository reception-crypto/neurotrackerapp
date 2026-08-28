import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
import 'package:neurotrackerapp/models/patient_profile.dart';
import 'package:neurotrackerapp/services/identity_service.dart';
import 'package:neurotrackerapp/services/storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    IdentityService.useInMemoryStorageForTesting = true;
    IdentityService.accessTokenForTesting = 'test-device-token';
  });

  test('entry history is stored once and returned newest first', () async {
    const older = DailyEntry(
      submissionId: 'older',
      patientId: 'patient-1',
      date: '2026-07-16',
      time: '19:00',
      patientName: 'Synthetic Patient',
      records: [
        SymptomScoreRecord(
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Headache',
          score: 3,
        ),
      ],
      wellnessPercent: 70,
    );
    const newer = DailyEntry(
      submissionId: 'newer',
      patientId: 'patient-1',
      date: '2026-07-17',
      time: '19:00',
      patientName: 'Synthetic Patient',
      records: [
        SymptomScoreRecord(
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Headache',
          score: 2,
        ),
      ],
      wellnessPercent: 80,
    );

    await StorageService.saveEntryToHistory(older);
    await StorageService.saveEntryToHistory(newer);
    await StorageService.saveEntryToHistory(newer);

    final history = await StorageService.loadEntryHistory();
    expect(history.map((entry) => entry.submissionId), ['newer', 'older']);
  });

  test('daily completion uses the local calendar date', () async {
    await StorageService.recordSubmissionDate('2026-07-27');

    expect(
      await StorageService.hasSubmittedToday(
        now: DateTime(2026, 7, 27, 23, 59),
      ),
      isTrue,
    );
    expect(
      await StorageService.hasSubmittedToday(now: DateTime(2026, 7, 28)),
      isFalse,
    );
  });

  test('daily completion falls back to saved history', () async {
    const entry = DailyEntry(
      submissionId: 'history-only',
      patientId: 'patient-1',
      date: '2026-07-27',
      time: '19:00',
      patientName: 'Synthetic Patient',
      records: [
        SymptomScoreRecord(
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Headache',
          score: 3,
        ),
      ],
      wellnessPercent: 70,
    );

    await StorageService.saveEntryToHistory(entry);

    expect(await StorageService.hasSubmittedOn('2026-07-27'), isTrue);
    expect(await StorageService.hasSubmittedOn('2026-07-28'), isFalse);
  });

  test('a queued entry alone blocks a second check-in for that date', () async {
    const entry = DailyEntry(
      submissionId: 'pending-only',
      patientId: 'patient-1',
      date: '2026-07-27',
      time: '19:00',
      patientName: 'Synthetic Patient',
      records: [
        SymptomScoreRecord(
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Headache',
          score: 3,
        ),
      ],
      wellnessPercent: 70,
    );

    await StorageService.addPendingEntry(entry);

    expect(await StorageService.hasSubmittedOn(entry.date), isTrue);
  });

  test('daily-entry staging and retry completion are idempotent', () async {
    const entry = DailyEntry(
      schemaVersion: 3,
      submissionId: 'idempotent-local-entry',
      patientId: 'patient-independent',
      date: '2026-08-14',
      time: '19:00',
      patientName: 'Independent Patient',
      profileRevision: 4,
      profileDisorderIds: ['migraine'],
      profileDisorders: ['Migraine'],
      records: [
        SymptomScoreRecord(
          track: 'Independent',
          symptomId: 'headache',
          disorder: '',
          symptom: 'Headache',
          score: 3,
        ),
      ],
      wellnessPercent: 70,
    );
    const rows = <String>[
      'idempotent-local-entry,2026-08-14,19:00,Independent Patient,'
          'Independent,,Headache,3,70,patient-independent,4,,headache,3,'
          'migraine,Migraine',
    ];

    await StorageService.stageDailyEntry(entry, rows);
    await StorageService.stageDailyEntry(entry, rows);
    await StorageService.completePendingEntry(entry, rows);
    await StorageService.completePendingEntry(entry, rows);

    expect(await StorageService.loadEntries(), hasLength(1));
    expect(await StorageService.loadEntryHistory(), hasLength(1));
    expect(await StorageService.pendingCount(), 0);
    expect(await StorageService.hasSubmittedOn(entry.date), isTrue);
  });

  test('queued Build 7 entry without schema remains schema 1', () async {
    SharedPreferences.setMockInitialValues({
      'pending_uploads': <String>[
        jsonEncode({
          'submissionId': 'legacy-pending',
          'patientId': 'patient-1',
          'date': '2026-08-14',
          'time': '19:00',
          'patientName': 'Synthetic Patient',
          'profileRevision': 2,
          'records': [
            {
              'track': 'Primary',
              'disorder': 'Migraine',
              'symptom': 'Headache',
              'score': 3,
            },
          ],
          'wellnessPercent': 70,
        }),
      ],
    });

    final pending = await StorageService.loadPendingEntries();

    expect(pending, hasLength(1));
    expect(pending.single.schemaVersion, 1);
    expect(pending.single.toApiJson()['schemaVersion'], 1);
    expect(
      pending.single.toApiJson().containsKey('clientEntryVersion'),
      isFalse,
    );
  });

  test(
    'schema 3 profile survives local storage without nesting symptoms',
    () async {
      const profile = PatientProfile(
        patientId: 'patient-independent',
        fullName: 'Independent Patient',
        schemaVersion: 3,
        disorderIds: ['migraine', 'dysautonomia'],
        disorders: ['Migraine', 'Dysautonomia'],
        symptomIds: ['headache', 'weakness'],
        symptoms: ['Headache', 'Weakness'],
        reminderTime: TimeOfDay(hour: 18, minute: 45),
        profileRevision: 6,
      );

      await StorageService.saveProfile(profile);
      final restored = await StorageService.loadProfile();

      expect(restored, isNotNull);
      expect(restored!.isIndependent, isTrue);
      expect(restored.primarySymptoms, isEmpty);
      expect(restored.symptoms, ['Headache', 'Weakness']);
      expect(restored.assignedDisorders, ['Migraine', 'Dysautonomia']);
    },
  );

  test(
    'reset removes the protected device credential and local data',
    () async {
      await StorageService.recordSubmissionDate('2026-07-27');

      await StorageService.resetAll();

      expect(IdentityService.accessTokenForTesting, isNull);
      expect(await StorageService.hasSubmittedOn('2026-07-27'), isFalse);
    },
  );
}
