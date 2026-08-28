import 'daily_entry.dart';

class DiaryChartPoint {
  final DateTime date;
  final double value;

  const DiaryChartPoint({required this.date, required this.value});
}

class DiaryChartSeries {
  final String key;
  final String label;
  final List<DiaryChartPoint> points;

  const DiaryChartSeries({
    required this.key,
    required this.label,
    required this.points,
  });
}

DateTime? diaryDate(String value) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(value);
  if (match == null) return null;
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final date = DateTime.utc(year, month, day);
  if (date.year != year || date.month != month || date.day != day) return null;
  return date;
}

List<DailyEntry> diaryEntriesInRange(
  Iterable<DailyEntry> entries, {
  required int days,
  DateTime? now,
}) {
  final safeDays = [30, 60, 90].contains(days) ? days : 30;
  final current = now ?? DateTime.now();
  final end = DateTime.utc(current.year, current.month, current.day);
  final start = end.subtract(Duration(days: safeDays - 1));
  return entries.where((entry) {
    final date = diaryDate(entry.date);
    return date != null && !date.isBefore(start) && !date.isAfter(end);
  }).toList(growable: false);
}

DiaryChartSeries wellnessDiarySeries(
  Iterable<DailyEntry> entries, {
  required int days,
  DateTime? now,
}) {
  final values = <DateTime, List<double>>{};
  for (final entry in diaryEntriesInRange(entries, days: days, now: now)) {
    if (entry.wellnessPercent < 10 || entry.wellnessPercent > 100) continue;
    final date = diaryDate(entry.date)!;
    values.putIfAbsent(date, () => <double>[]).add(
      entry.wellnessPercent.toDouble(),
    );
  }
  return DiaryChartSeries(
    key: 'wellness',
    label: 'Wellness',
    points: _points(values),
  );
}

List<DiaryChartSeries> symptomDiarySeries(
  Iterable<DailyEntry> entries, {
  required int days,
  DateTime? now,
}) {
  final values = <String, Map<DateTime, List<double>>>{};
  final labels = <String, String>{};
  for (final entry in diaryEntriesInRange(entries, days: days, now: now)) {
    final date = diaryDate(entry.date)!;
    for (final record in entry.records) {
      final key = record.symptomId.trim().isNotEmpty
          ? record.symptomId.trim()
          : record.symptom.trim().toLowerCase();
      if (key.isEmpty) continue;
      labels[key] = record.symptom.trim().isEmpty ? key : record.symptom.trim();
      values
          .putIfAbsent(key, () => <DateTime, List<double>>{})
          .putIfAbsent(date, () => <double>[])
          .add(record.score.toDouble());
    }
  }
  final series = values.entries.map((entry) {
    return DiaryChartSeries(
      key: entry.key,
      label: labels[entry.key] ?? entry.key,
      points: _points(entry.value),
    );
  }).toList();
  series.sort((left, right) => left.label.compareTo(right.label));
  return series;
}

List<DiaryChartPoint> _points(Map<DateTime, List<double>> values) {
  final points = values.entries.map((entry) {
    final average = entry.value.reduce((left, right) => left + right) /
        entry.value.length;
    return DiaryChartPoint(date: entry.key, value: average);
  }).toList();
  points.sort((left, right) => left.date.compareTo(right.date));
  return points;
}
