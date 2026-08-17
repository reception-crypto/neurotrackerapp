class SymptomScoreRecord {
  final String track;
  final String disorderId;
  final String disorder;
  final String symptomId;
  final String symptom;
  final int score;

  const SymptomScoreRecord({
    required this.track,
    this.disorderId = '',
    required this.disorder,
    this.symptomId = '',
    required this.symptom,
    required this.score,
  });

  Map<String, dynamic> toJson() => {
    'track': track,
    'disorderId': disorderId,
    'disorder': disorder,
    'symptomId': symptomId,
    'symptom': symptom,
    'score': score,
  };

  factory SymptomScoreRecord.fromJson(Map<String, dynamic> json) {
    return SymptomScoreRecord(
      track: json['track'] as String? ?? 'Primary',
      disorderId: json['disorderId'] as String? ?? '',
      disorder: json['disorder'] as String? ?? '',
      symptomId: json['symptomId'] as String? ?? '',
      symptom: json['symptom'] as String? ?? '',
      score: (json['score'] as num?)?.toInt() ?? 0,
    );
  }
}

class DailyEntry {
  final int schemaVersion;
  final String submissionId;
  final String date;
  final String time;
  final String patientName;
  final String patientId;
  final int profileRevision;
  final List<String> profileDisorderIds;
  final List<String> profileDisorders;
  final List<SymptomScoreRecord> records;
  final int wellnessPercent;

  const DailyEntry({
    this.schemaVersion = 1,
    required this.submissionId,
    required this.date,
    required this.time,
    required this.patientName,
    required this.patientId,
    this.profileRevision = 0,
    this.profileDisorderIds = const [],
    this.profileDisorders = const [],
    required this.records,
    required this.wellnessPercent,
  });

  Map<String, dynamic> toJson() => {
    'schemaVersion': schemaVersion,
    'submissionId': submissionId,
    'date': date,
    'time': time,
    'patientName': patientName,
    'patientId': patientId,
    'profileRevision': profileRevision,
    'profileDisorderIds': profileDisorderIds,
    'profileDisorders': profileDisorders,
    'wellnessPercent': wellnessPercent,
    'records': records.map((record) => record.toJson()).toList(),
  };

  Map<String, dynamic> toApiJson({String? deviceId}) => {
    ...toJson(),
    'deviceId': deviceId ?? '',
  };

  factory DailyEntry.fromJson(Map<String, dynamic> json) {
    return DailyEntry(
      // Missing schema data is deliberately interpreted as the public Build 7
      // payload model so queued submissions survive an app upgrade unchanged.
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
      submissionId: json['submissionId'] as String? ?? '',
      date: json['date'] as String? ?? '',
      time: json['time'] as String? ?? '',
      patientName: json['patientName'] as String? ?? '',
      patientId: json['patientId'] as String? ?? '',
      profileRevision: (json['profileRevision'] as num?)?.toInt() ?? 0,
      profileDisorderIds: _textList(json['profileDisorderIds']),
      profileDisorders: _textList(json['profileDisorders']),
      wellnessPercent: (json['wellnessPercent'] as num?)?.toInt() ?? 0,
      records: ((json['records'] as List?) ?? const [])
          .map(
            (record) => SymptomScoreRecord.fromJson(
              Map<String, dynamic>.from(record as Map),
            ),
          )
          .toList(),
    );
  }

  static List<String> _textList(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<String>()
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }
}
