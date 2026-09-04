import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
import 'package:neurotrackerapp/models/patient_profile.dart';
import 'package:neurotrackerapp/services/csv_service.dart';

void main() {
  test('support ID is a shortened stable representation of PatientId', () {
    const profile = PatientProfile(
      patientId: 'pt-12345678-abcd-90ef',
      fullName: 'Synthetic Patient',
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
      reminderTime: TimeOfDay(hour: 19, minute: 0),
      profileRevision: 4,
    );

    expect(profile.supportId, 'NS-5678-ABCD-90EF');
  });

  test('local CSV retains identity and additive schema columns', () {
    const entry = DailyEntry(
      schemaVersion: 2,
      submissionId: 'NS-test',
      patientId: 'pt-clinic-123',
      date: '2026-07-27',
      time: '19:00',
      patientName: 'Synthetic Patient',
      profileRevision: 4,
      records: [
        SymptomScoreRecord(
          track: 'Primary',
          disorderId: 'migraine',
          disorder: 'Migraine',
          symptomId: 'headache',
          symptom: 'Headache',
          score: 3,
        ),
      ],
      wellnessPercent: 70,
    );

    final csv = CsvService.buildCsv(CsvService.rowsFromEntry(entry));
    final header = csv.split('\n').first;
    final row = csv.split('\n').last;

    expect(header, contains('PatientId,ProfileRevision'));
    expect(
      header,
      endsWith(
        'DisorderId,SymptomId,PayloadSchemaVersion,ProfileDisorderIds,ProfileDisorders',
      ),
    );
    expect(row, contains(',pt-clinic-123,4,migraine,headache,2,,'));
  });

  test('legacy Build 5 CSV rows gain blank additive columns', () {
    const legacyRow =
        'NS-old,2026-07-26,19:00,Synthetic Patient,Primary,Migraine,Headache,4,80';

    final csv = CsvService.buildCsv([legacyRow]);
    final row = csv.split('\n').last;

    expect(row.split(',').length, 16);
    expect(row, endsWith(',80,,,,,,,'));
  });

  test('a check-in cannot be generated before clinic enrolment', () {
    const profile = PatientProfile(
      patientId: '',
      fullName: 'Synthetic Patient',
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
      reminderTime: TimeOfDay(hour: 19, minute: 0),
    );

    expect(
      () => CsvService.generateDailyEntry(
        profile: profile,
        symptomScores: const {
          'Primary|Migraine|Headache': 1,
          'Primary|Migraine|Nausea': 2,
          'Primary|Migraine|Vomiting': 3,
        },
        wellnessPercent: 70,
      ),
      throwsStateError,
    );
  });

  test('a check-in requires a synchronised clinic profile revision', () {
    const profile = PatientProfile(
      patientId: 'pt-legacy-profile',
      fullName: 'Synthetic Patient',
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
      reminderTime: TimeOfDay(hour: 19, minute: 0),
    );

    expect(
      () => CsvService.generateDailyEntry(
        profile: profile,
        symptomScores: const {
          'Primary|Migraine|Headache': 1,
          'Primary|Migraine|Nausea': 2,
          'Primary|Migraine|Vomiting': 3,
        },
        wellnessPercent: 70,
      ),
      throwsStateError,
    );
  });

  test(
    'Build 9 creates a globally safe backdated entry up to seven days ago',
    () {
      const profile = PatientProfile(
        patientId: 'pt-backdated-profile',
        fullName: 'Backdated Patient',
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
        reminderTime: TimeOfDay(hour: 19, minute: 0),
        profileRevision: 2,
      );
      final now = DateTime(2026, 8, 28, 19, 30);
      final entry = CsvService.generateDailyEntry(
        profile: profile,
        symptomScores: const {
          'Primary|Migraine|Headache': 1,
          'Primary|Migraine|Nausea': 2,
          'Primary|Migraine|Vomiting': 3,
        },
        wellnessPercent: 70,
        entryDate: DateTime(2026, 8, 21),
        now: now,
      );

      expect(entry.date, '2026-08-21');
      expect(entry.clientEntryVersion, 2);
      expect(entry.createdAtUtc, now.toUtc().toIso8601String());
      expect(entry.localUtcOffsetMinutes, now.timeZoneOffset.inMinutes);
      expect(entry.entryDateSource, 'backdated');

      expect(
        () => CsvService.generateDailyEntry(
          profile: profile,
          symptomScores: const {
            'Primary|Migraine|Headache': 1,
            'Primary|Migraine|Nausea': 2,
            'Primary|Migraine|Vomiting': 3,
          },
          wellnessPercent: 70,
          entryDate: DateTime(2026, 8, 20),
          now: now,
        ),
        throwsStateError,
      );
    },
  );

  test('missing profile schema is interpreted as the Build 7 model', () {
    final profile = PatientProfile.fromClinicResponse({
      'patientId': 'pt-clinic-profile',
      'displayName': 'Clinic Name',
      'clinicalProfile': {
        'primaryDisorder': 'Dysautonomia',
        'primarySymptoms': ['Dizziness', 'Pain', 'Weakness'],
        'secondaryDisorder': null,
        'secondarySymptoms': <String>[],
        'revision': 3,
      },
    }, reminderTime: const TimeOfDay(hour: 18, minute: 30));

    expect(profile.schemaVersion, 1);
    expect(profile.payloadSchemaVersion, 1);
    expect(profile.primarySymptoms, ['Dizziness', 'Pain', 'Weakness']);
    expect(profile.isIndependent, isFalse);
  });

  test('canonical nested profile produces a schema 2 payload', () {
    final profile = PatientProfile.fromClinicResponse({
      'patientId': 'pt-canonical-profile',
      'displayName': 'Canonical Patient',
      'clinicalProfile': {
        'schemaVersion': 2,
        'primaryDisorderId': 'migraine',
        'primaryDisorder': 'Migraine',
        'primarySymptomIds': ['headache', 'nausea', 'vertigo'],
        'primarySymptoms': ['Headache', 'Nausea', 'Vertigo'],
        'secondaryDisorderId': null,
        'secondaryDisorder': null,
        'secondarySymptomIds': <String>[],
        'secondarySymptoms': <String>[],
        'revision': 5,
      },
    }, reminderTime: const TimeOfDay(hour: 19, minute: 0));

    final entry = CsvService.generateDailyEntry(
      profile: profile,
      symptomScores: const {
        'Primary|Migraine|Headache': 2,
        'Primary|Migraine|Nausea': 3,
        'Primary|Migraine|Vertigo': 4,
      },
      wellnessPercent: 70,
    );

    expect(entry.schemaVersion, 2);
    expect(entry.records.first.disorderId, 'migraine');
    expect(entry.records.last.symptomId, 'vertigo');
  });

  test('independent profile rates every assigned symptom exactly once', () {
    final profile = PatientProfile.fromClinicResponse({
      'patientId': 'pt-independent-profile',
      'displayName': 'Independent Patient',
      'clinicalProfile': {
        'schemaVersion': 3,
        'disorderIds': ['migraine', 'dysautonomia'],
        'disorders': ['Migraine', 'Dysautonomia'],
        'symptomIds': ['headache', 'weakness', 'pain', 'vertigo'],
        'symptoms': ['Headache', 'Weakness', 'Pain', 'Vertigo'],
        'minimumAppBuild': 8,
        'revision': 6,
      },
    }, reminderTime: const TimeOfDay(hour: 19, minute: 0));

    final entry = CsvService.generateDailyEntry(
      profile: profile,
      symptomScores: const {
        'Independent||headache': 1,
        'Independent||weakness': 2,
        'Independent||pain': 3,
        'Independent||vertigo': 4,
      },
      wellnessPercent: 80,
    );
    final payload = entry.toApiJson();

    expect(profile.assignedDisorders, ['Migraine', 'Dysautonomia']);
    expect(entry.schemaVersion, 3);
    expect(entry.profileDisorderIds, ['migraine', 'dysautonomia']);
    expect(entry.records, hasLength(4));
    expect(entry.records.map((record) => record.track).toSet(), {
      'Independent',
    });
    expect(entry.records.map((record) => record.disorder).toSet(), {''});
    expect(
      (payload['records'] as List)
          .map((record) => (record as Map)['symptomId'])
          .toList(),
      ['headache', 'weakness', 'pain', 'vertigo'],
    );
  });

  test('independent profile rejects more than six symptoms', () {
    expect(
      () => PatientProfile.fromClinicResponse({
        'patientId': 'pt-too-many',
        'displayName': 'Too Many',
        'clinicalProfile': {
          'schemaVersion': 3,
          'disorderIds': ['migraine'],
          'disorders': ['Migraine'],
          'symptomIds': ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
          'symptoms': ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
          'revision': 1,
        },
      }, reminderTime: const TimeOfDay(hour: 19, minute: 0)),
      throwsFormatException,
    );
  });
}
