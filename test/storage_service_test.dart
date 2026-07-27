import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
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

  test('reset removes the protected device credential and local data', () async {
    await StorageService.recordSubmissionDate('2026-07-27');

    await StorageService.resetAll();

    expect(IdentityService.accessTokenForTesting, isNull);
    expect(await StorageService.hasSubmittedOn('2026-07-27'), isFalse);
  });
}
