import 'package:flutter/material.dart';

import '../models/daily_entry.dart';
import '../models/diary_chart_data.dart';
import '../services/diary_service.dart';
import '../theme/app_theme.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  int _days = 30;
  late Future<DiaryHistoryResult> _history;

  @override
  void initState() {
    super.initState();
    _history = DiaryService.loadHistory();
  }

  Future<void> _refresh() async {
    final refreshed = DiaryService.loadHistory();
    setState(() => _history = refreshed);
    await refreshed;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patient Diary')),
      body: FutureBuilder<DiaryHistoryResult>(
        future: _history,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final result = snapshot.data ??
              const DiaryHistoryResult(
                entries: <DailyEntry>[],
                clinicSynced: false,
                statusMessage: 'Diary history is unavailable.',
              );
          final visibleEntries = diaryEntriesInRange(
            result.entries,
            days: _days,
          );
          final wellness = wellnessDiarySeries(
            result.entries,
            days: _days,
          );
          final symptoms = symptomDiarySeries(
            result.entries,
            days: _days,
          );
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Card(
                  child: ListTile(
                    leading: Icon(
                      result.clinicSynced
                          ? Icons.cloud_done_outlined
                          : Icons.cloud_off_outlined,
                      color: result.clinicSynced
                          ? AppTheme.successGreen
                          : AppTheme.secondaryText,
                    ),
                    title: Text(result.statusMessage),
                    subtitle: const Text('Pull down to refresh.'),
                  ),
                ),
                const SizedBox(height: 8),
                Center(
                  child: SegmentedButton<int>(
                    key: const Key('diary-range-selector'),
                    segments: const [
                      ButtonSegment(value: 30, label: Text('30 days')),
                      ButtonSegment(value: 60, label: Text('60 days')),
                      ButtonSegment(value: 90, label: Text('90 days')),
                    ],
                    selected: {_days},
                    onSelectionChanged: (selection) {
                      setState(() => _days = selection.single);
                    },
                  ),
                ),
                const SizedBox(height: 12),
                _DiaryChartCard(
                  title: 'Overall wellness',
                  subtitle: '10% is the worst possible day; 100% is the best.',
                  series: [wellness],
                  maximumValue: 100,
                  days: _days,
                  valueSuffix: '%',
                ),
                _DiaryChartCard(
                  title: 'Symptoms',
                  subtitle: '0 means not present; 10 is the worst it has been.',
                  series: symptoms,
                  maximumValue: 10,
                  days: _days,
                  valueSuffix: '/10',
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
                  child: Text(
                    'Check-ins · last $_days days',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                if (visibleEntries.isEmpty)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'No check-ins were recorded in this date range.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                else
                  ...visibleEntries.map(_HistoryCard.new),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _DiaryChartCard extends StatelessWidget {
  static const _colours = <Color>[
    Color(0xff2563eb),
    Color(0xffdc2626),
    Color(0xff059669),
    Color(0xff7c3aed),
    Color(0xffd97706),
    Color(0xff0891b2),
  ];

  final String title;
  final String subtitle;
  final List<DiaryChartSeries> series;
  final double maximumValue;
  final int days;
  final String valueSuffix;

  const _DiaryChartCard({
    required this.title,
    required this.subtitle,
    required this.series,
    required this.maximumValue,
    required this.days,
    required this.valueSuffix,
  });

  @override
  Widget build(BuildContext context) {
    final visibleSeries = series
        .where((item) => item.points.isNotEmpty)
        .toList(growable: false);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: AppTheme.secondaryText),
            ),
            const SizedBox(height: 14),
            if (visibleSeries.isEmpty)
              const SizedBox(
                height: 160,
                child: Center(child: Text('No data in this range.')),
              )
            else ...[
              Semantics(
                label: '$title line graph for the last $days days',
                child: AspectRatio(
                  aspectRatio: 1.65,
                  child: CustomPaint(
                    painter: _DiaryLineChartPainter(
                      series: visibleSeries,
                      colours: _colours,
                      maximumValue: maximumValue,
                      days: days,
                      textColor: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [Text('$days days ago'), const Text('Today')],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: visibleSeries.indexed.map((indexed) {
                  final (index, item) = indexed;
                  final latest = item.points.last.value;
                  final value = maximumValue == 10
                      ? latest.toStringAsFixed(1)
                      : latest.round().toString();
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 14,
                        height: 4,
                        color: _colours[index % _colours.length],
                      ),
                      const SizedBox(width: 6),
                      Text('${item.label} $value$valueSuffix'),
                    ],
                  );
                }).toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DiaryLineChartPainter extends CustomPainter {
  final List<DiaryChartSeries> series;
  final List<Color> colours;
  final double maximumValue;
  final int days;
  final Color textColor;

  const _DiaryLineChartPainter({
    required this.series,
    required this.colours,
    required this.maximumValue,
    required this.days,
    required this.textColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const left = 34.0;
    const top = 10.0;
    const right = 8.0;
    const bottom = 12.0;
    final chartWidth = size.width - left - right;
    final chartHeight = size.height - top - bottom;
    final today = DateTime.now();
    final end = DateTime.utc(today.year, today.month, today.day);
    final start = end.subtract(Duration(days: days - 1));
    final gridPaint = Paint()
      ..color = textColor.withValues(alpha: 0.18)
      ..strokeWidth = 1;
    for (var index = 0; index <= 4; index++) {
      final y = top + chartHeight * index / 4;
      canvas.drawLine(
        Offset(left, y),
        Offset(size.width - right, y),
        gridPaint,
      );
      final value = maximumValue * (4 - index) / 4;
      final label = maximumValue == 10
          ? value.toStringAsFixed(value % 1 == 0 ? 0 : 1)
          : value.round().toString();
      final painter = TextPainter(
        text: TextSpan(
          text: label,
          style: TextStyle(color: textColor, fontSize: 10),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter.paint(canvas, Offset(left - painter.width - 6, y - 6));
    }

    for (final indexed in series.indexed) {
      final (seriesIndex, item) = indexed;
      final colour = colours[seriesIndex % colours.length];
      final linePaint = Paint()
        ..color = colour
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      final pointPaint = Paint()..color = colour;
      final path = Path();
      var hasPoint = false;
      for (final point in item.points) {
        final offsetDays = point.date.difference(start).inDays;
        if (offsetDays < 0 || offsetDays >= days) continue;
        final x = left + chartWidth * offsetDays / (days - 1);
        final safeValue = point.value.clamp(0, maximumValue).toDouble();
        final y = top + chartHeight * (1 - safeValue / maximumValue);
        if (!hasPoint) {
          path.moveTo(x, y);
          hasPoint = true;
        } else {
          path.lineTo(x, y);
        }
        canvas.drawCircle(Offset(x, y), 3.2, pointPaint);
      }
      if (hasPoint) canvas.drawPath(path, linePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _DiaryLineChartPainter oldDelegate) {
    return oldDelegate.series != series ||
        oldDelegate.maximumValue != maximumValue ||
        oldDelegate.days != days ||
        oldDelegate.textColor != textColor;
  }
}

class _HistoryCard extends StatelessWidget {
  final DailyEntry entry;

  const _HistoryCard(this.entry);

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ExpansionTile(
        leading: const Icon(Icons.event_note),
        title: Text(_displayDate(entry.date)),
        subtitle: Text(
          entry.wellnessPercent > 0
              ? 'Wellness ${entry.wellnessPercent}% · ${entry.time}'
              : 'Wellness not recorded · ${entry.time}',
        ),
        children: entry.records
            .map(
              (record) => ListTile(
                dense: true,
                title: Text(record.symptom),
                subtitle: Text(_recordContext(record)),
                trailing: Text(
                  '${record.score}/10',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            )
            .toList(),
      ),
    );
  }

  String _displayDate(String value) {
    final date = diaryDate(value);
    if (date == null) return value;
    return '${date.day}/${date.month}/${date.year}';
  }

  String _recordContext(SymptomScoreRecord record) {
    if (record.track != 'Independent') {
      return '${record.track}: ${record.disorder}';
    }
    if (entry.profileDisorders.isEmpty) return 'Clinic-assigned symptom';
    return 'Disorders: ${entry.profileDisorders.join(', ')}';
  }
}
