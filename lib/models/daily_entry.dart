class SymptomScoreRecord {
  final String track;
  final String disorder;
  final String symptom;
  final int score;

  const SymptomScoreRecord({
    required this.track,
    required this.disorder,
    required this.symptom,
    required this.score,
  });

  Map<String, dynamic> toJson() => {
        'track': track,
        'disorder': disorder,
        'symptom': symptom,
        'score': score,
      };

  factory SymptomScoreRecord.fromJson(Map<String, dynamic> json) {
    return SymptomScoreRecord(
      track: json['track'] as String? ?? 'Primary',
      disorder: json['disorder'] as String? ?? '',
      symptom: json['symptom'] as String? ?? '',
      score: (json['score'] as num?)?.toInt() ?? 0,
    );
  }
}

class DailyEntry {
  final String submissionId;
  final String date;
  final String time;
  final String patientName;
  final String patientId;
  final List<SymptomScoreRecord> records;
  final int wellnessPercent;

  const DailyEntry({
    required this.submissionId,
    required this.date,
    required this.time,
    required this.patientName,
    required this.patientId,
    required this.records,
    required this.wellnessPercent,
  });

  Map<String, dynamic> toJson() => {
        'submissionId': submissionId,
        'date': date,
        'time': time,
        'patientName': patientName,
        'patientId': patientId,
        'wellnessPercent': wellnessPercent,
        'records': records.map((record) => record.toJson()).toList(),
      };

  Map<String, dynamic> toApiJson({String? deviceId}) => {
        ...toJson(),
        'deviceId': deviceId ?? '',
      };

  factory DailyEntry.fromJson(Map<String, dynamic> json) {
    return DailyEntry(
      submissionId: json['submissionId'] as String? ?? '',
      date: json['date'] as String? ?? '',
      time: json['time'] as String? ?? '',
      patientName: json['patientName'] as String? ?? '',
      patientId: json['patientId'] as String? ?? '',
      wellnessPercent: (json['wellnessPercent'] as num?)?.toInt() ?? 0,
      records: ((json['records'] as List?) ?? const [])
          .map((record) => SymptomScoreRecord.fromJson(
                Map<String, dynamic>.from(record as Map),
              ))
          .toList(),
    );
  }
}
