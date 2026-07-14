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
}

class DailyEntry {
  final String date;
  final String time;
  final String patientName;
  final List<SymptomScoreRecord> records;
  final int wellnessPercent;

  const DailyEntry({
    required this.date,
    required this.time,
    required this.patientName,
    required this.records,
    required this.wellnessPercent,
  });

  Map<String, dynamic> toApiJson({String? deviceId}) => {
        'deviceId': deviceId ?? '',
        'date': date,
        'time': time,
        'patientName': patientName,
        'wellnessPercent': wellnessPercent,
        'records': records.map((record) => record.toJson()).toList(),
      };
}
