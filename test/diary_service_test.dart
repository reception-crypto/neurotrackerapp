import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
import 'package:neurotrackerapp/models/patient_profile.dart';
import 'package:neurotrackerapp/services/diary_service.dart';
import 'package:neurotrackerapp/services/identity_service.dart';
import 'package:neurotrackerapp/services/storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

DailyEntry _entry(String patientId, String submissionId) => DailyEntry(
  submissionId: submissionId,
  date: '2026-08-28',
  time: '10:00',
  patientName: 'Synthetic Patient',
  patientId: patientId,
  records: const [
    SymptomScoreRecord(
      track: 'Primary',
      disorder: 'Migraine',
      symptom: 'Headache',
      score: 4,
    ),
  ],
  wellnessPercent: 70,
);

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    IdentityService.useInMemoryStorageForTesting = true;
    IdentityService.accessTokenForTesting = 'synthetic-token';
  });

  test('local diary never exposes another enrolled identity history', () async {
    await StorageService.saveProfile(
      const PatientProfile(
        patientId: 'patient-current',
        fullName: 'Current Patient',
        primaryDisorder: 'Migraine',
        primarySymptoms: ['Headache', 'Nausea', 'Fatigue'],
        reminderTime: TimeOfDay(hour: 19, minute: 0),
        profileRevision: 1,
      ),
    );
    await StorageService.saveEntryToHistory(
      _entry('patient-current', 'current-entry'),
    );
    await StorageService.saveEntryToHistory(
      _entry('patient-previous', 'previous-entry'),
    );

    final result = await DiaryService.loadHistory();

    expect(result.entries.map((entry) => entry.submissionId).toList(), [
      'current-entry',
    ]);
  });
}
