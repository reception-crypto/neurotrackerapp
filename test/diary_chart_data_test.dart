import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
import 'package:neurotrackerapp/models/diary_chart_data.dart';

DailyEntry entry({
  required String id,
  required String date,
  required int wellness,
  required int headache,
  int? nausea,
}) {
  return DailyEntry(
    submissionId: id,
    patientId: 'patient-1',
    date: date,
    time: '19:00',
    patientName: 'Synthetic Patient',
    records: [
      SymptomScoreRecord(
        track: 'Independent',
        symptomId: 'headache',
        disorder: '',
        symptom: 'Headache',
        score: headache,
      ),
      if (nausea != null)
        SymptomScoreRecord(
          track: 'Independent',
          symptomId: 'nausea',
          disorder: '',
          symptom: 'Nausea',
          score: nausea,
        ),
    ],
    wellnessPercent: wellness,
  );
}

void main() {
  final now = DateTime(2026, 8, 28, 22);
  final entries = [
    entry(
      id: 'today',
      date: '2026-08-28',
      wellness: 80,
      headache: 2,
      nausea: 3,
    ),
    entry(id: 'ten-days', date: '2026-08-18', wellness: 60, headache: 5),
    entry(id: 'forty-days', date: '2026-07-19', wellness: 40, headache: 8),
  ];

  test('30 day wellness series excludes older entries', () {
    final series = wellnessDiarySeries(entries, days: 30, now: now);

    expect(series.points.map((point) => point.value), [60, 80]);
    expect(series.points.map((point) => point.date.toIso8601String()), [
      '2026-08-18T00:00:00.000Z',
      '2026-08-28T00:00:00.000Z',
    ]);
  });

  test('60 day symptom chart keeps separate symptom lines', () {
    final series = symptomDiarySeries(entries, days: 60, now: now);

    expect(series.map((item) => item.label), ['Headache', 'Nausea']);
    expect(series.first.points.map((point) => point.value), [8, 5, 2]);
    expect(series.last.points.single.value, 3);
  });

  test('invalid calendar dates never enter chart ranges', () {
    final malformed = entry(
      id: 'invalid',
      date: '2026-02-31',
      wellness: 50,
      headache: 4,
    );

    expect(diaryDate(malformed.date), isNull);
    expect(diaryEntriesInRange([malformed], days: 90, now: now), isEmpty);
  });

  test('missing legacy wellness is not plotted as zero', () {
    final missing = entry(
      id: 'missing-wellness',
      date: '2026-08-28',
      wellness: 0,
      headache: 4,
    );

    expect(wellnessDiarySeries([missing], days: 30, now: now).points, isEmpty);
  });
}
