import '../models/daily_entry.dart';
import '../models/patient_profile.dart';

class CsvService {
  static const header =
      'SubmissionId,Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent,PatientId,ProfileRevision,DisorderId,SymptomId,PayloadSchemaVersion,ProfileDisorderIds,ProfileDisorders';
  static const _columnCountForHeader = 16;

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
    final assignments = profile.symptomAssignments;
    final validCount = profile.isIndependent
        ? assignments.isNotEmpty &&
              assignments.length <= maximumIndependentProfileSymptoms
        : assignments.length == 3 || assignments.length == 6;
    if (!validCount) {
      throw StateError('The clinic-assigned symptom list is invalid.');
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

    final records = assignments
        .map(
          (assignment) => SymptomScoreRecord(
            track: assignment.track,
            disorderId: assignment.disorderId,
            disorder: assignment.disorder,
            symptomId: assignment.symptomId,
            symptom: assignment.symptom,
            score: _requiredScore(
              symptomScores,
              assignment.scoreKey,
              assignment.symptom,
            ),
          ),
        )
        .toList(growable: false);

    return DailyEntry(
      schemaVersion: profile.payloadSchemaVersion,
      submissionId: submissionId,
      date: date,
      time: time,
      patientName: profile.fullName,
      patientId: profile.patientId,
      profileRevision: profile.profileRevision,
      profileDisorderIds: profile.isIndependent
          ? profile.assignedDisorderIds
          : const [],
      profileDisorders: profile.isIndependent
          ? profile.assignedDisorders
          : const [],
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
        _escape(record.disorderId),
        _escape(record.symptomId),
        entry.schemaVersion,
        _escape(entry.profileDisorderIds.join('|')),
        _escape(entry.profileDisorders.join('|')),
      ].join(',');
    }).toList();
  }

  static String buildCsv(List<String> rows) {
    final normalisedRows = rows.map((row) {
      final columns = _countColumns(row);
      if (columns >= _columnCountForHeader) return row;
      return '$row${List.filled(_columnCountForHeader - columns, ',').join()}';
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

  static int _countColumns(String row) {
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
