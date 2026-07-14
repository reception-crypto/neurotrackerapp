import '../models/daily_entry.dart';
import '../models/patient_profile.dart';

class CsvService {
  static const header = 'Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent';

  static DailyEntry generateDailyEntry({
    required PatientProfile profile,
    required Map<String, int> symptomScores,
    required int wellnessPercent,
  }) {
    final now = DateTime.now();
    final date =
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final time =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';

    final records = <SymptomScoreRecord>[];

    for (final symptom in profile.primarySymptoms) {
      final key = 'Primary|${profile.primaryDisorder}|$symptom';
      records.add(SymptomScoreRecord(
        track: 'Primary',
        disorder: profile.primaryDisorder,
        symptom: symptom,
        score: symptomScores[key] ?? 0,
      ));
    }

    if (profile.hasSecondaryDisorder) {
      for (final symptom in profile.secondarySymptoms) {
        final key = 'Second|${profile.secondaryDisorder}|$symptom';
        records.add(SymptomScoreRecord(
          track: 'Second',
          disorder: profile.secondaryDisorder!,
          symptom: symptom,
          score: symptomScores[key] ?? 0,
        ));
      }
    }

    return DailyEntry(
      date: date,
      time: time,
      patientName: profile.fullName,
      records: records,
      wellnessPercent: wellnessPercent,
    );
  }

  static List<String> rowsFromEntry(DailyEntry entry) {
    return entry.records.map((record) {
      return [
        entry.date,
        entry.time,
        _escape(entry.patientName),
        _escape(record.track),
        _escape(record.disorder),
        _escape(record.symptom),
        record.score,
        entry.wellnessPercent,
      ].join(',');
    }).toList();
  }

  static String buildCsv(List<String> rows) {
    return [header, ...rows].join('\n');
  }

  static String _escape(String value) {
    if (value.contains(',') || value.contains('"') || value.contains('\n')) {
      return '"${value.replaceAll('"', '""')}"';
    }
    return value;
  }
}
