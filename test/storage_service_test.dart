import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
import 'package:neurotrackerapp/services/storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
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
}
