import 'package:flutter/material.dart';

import '../models/daily_entry.dart';
import '../services/storage_service.dart';

class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Check-in History')),
      body: FutureBuilder<List<DailyEntry>>(
        future: StorageService.loadEntryHistory(),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final entries = snapshot.data ?? const <DailyEntry>[];
          if (entries.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No check-ins have been recorded on this device yet.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: entries.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) => _HistoryCard(entry: entries[index]),
          );
        },
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final DailyEntry entry;

  const _HistoryCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ExpansionTile(
        leading: const Icon(Icons.event_note),
        title: Text(_displayDate(entry.date)),
        subtitle: Text('Wellness ${entry.wellnessPercent}% · ${entry.time}'),
        children: entry.records
            .map(
              (record) => ListTile(
                dense: true,
                title: Text(record.symptom),
                subtitle: Text('${record.track}: ${record.disorder}'),
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
    final date = DateTime.tryParse(value);
    if (date == null) return value;
    return '${date.day}/${date.month}/${date.year}';
  }
}
