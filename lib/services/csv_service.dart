import '../models/daily_entry.dart';
import '../models/patient_profile.dart';

class CsvService {
  static const header =
      'SubmissionId,Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent,PatientId,ProfileRevision';

  static DailyEntry generateDailyEntry({
    required PatientProfile profile,
    required Map<String, int?> symptomScores,
    required int wellnessPercent,
  }) {
    if (profile.patientId.trim().isEmpty) {
      throw StateError(
        'Clinic enrolment is required before recording a check-in.',
      );
    }
    if (!profile.isClinicManaged) {
      throw StateError(
        'The clinic-assigned profile must be synchronised before recording a check-in.',
      );
    }
    final now = DateTime.now();
    final date =
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final time =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final idFragment = profile.patientId.length <= 8
        ? profile.patientId
        : profile.patientId.substring(0, 8);
    final submissionId = 'NS-${now.microsecondsSinceEpoch}-$idFragment';

    final records = <SymptomScoreRecord>[];

    for (final symptom in profile.primarySymptoms) {
      final key = 'Primary|${profile.primaryDisorder}|$symptom';
      records.add(
        SymptomScoreRecord(
          track: 'Primary',
          disorder: profile.primaryDisorder,
          symptom: symptom,
          score: _requiredScore(symptomScores, key, symptom),
        ),
      );
    }

    if (profile.hasSecondaryDisorder) {
      for (final symptom in profile.secondarySymptoms) {
        final key = 'Second|${profile.secondaryDisorder}|$symptom';
        records.add(
          SymptomScoreRecord(
            track: 'Second',
            disorder: profile.secondaryDisorder!,
            symptom: symptom,
            score: _requiredScore(symptomScores, key, symptom),
          ),
        );
      }
    }

    return DailyEntry(
      submissionId: submissionId,
      date: date,
      time: time,
      patientName: profile.fullName,
      patientId: profile.patientId,
      profileRevision: profile.profileRevision,
      records: records,
      wellnessPercent: wellnessPercent,
    );
  }

  static List<String> rowsFromEntry(DailyEntry entry) {
    return entry.records.map((record) {
      return [
        _escape(entry.submissionId),
        entry.date,
        entry.time,
        _escape(entry.patientName),
        _escape(record.track),
        _escape(record.disorder),
        _escape(record.symptom),
        record.score,
        entry.wellnessPercent,
        _escape(entry.patientId),
        entry.profileRevision,
      ].join(',');
    }).toList();
  }

  static String buildCsv(List<String> rows) {
    final normalisedRows = rows.map((row) {
      final columns = _columnCount(row);
      if (columns == 9) return '$row,,';
      if (columns == 10) return '$row,';
      return row;
    });
    return [header, ...normalisedRows].join('\n');
  }

  static int _requiredScore(
    Map<String, int?> scores,
    String key,
    String symptom,
  ) {
    final score = scores[key];
    if (score == null) {
      throw StateError('A score is required for $symptom.');
    }
    return score;
  }

  static String _escape(String value) {
    if (value.contains(',') || value.contains('"') || value.contains('\n')) {
      return '"${value.replaceAll('"', '""')}"';
    }
    return value;
  }

  static int _columnCount(String row) {
    var columns = 1;
    var quoted = false;
    for (var index = 0; index < row.length; index++) {
      final character = row[index];
      if (character == '"') {
        if (quoted && index + 1 < row.length && row[index + 1] == '"') {
          index++;
        } else {
          quoted = !quoted;
        }
      } else if (character == ',' && !quoted) {
        columns++;
      }
    }
    return columns;
  }
}
