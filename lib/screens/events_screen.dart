import 'package:flutter/material.dart';

import '../services/events_service.dart';

class EventsScreen extends StatefulWidget {
  const EventsScreen({super.key});

  @override
  State<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends State<EventsScreen> {
  late final Future<List<ClinicEvent>> _events = EventsService.assigned();
  bool _saving = false;

  Future<void> _record(ClinicEvent event) async {
    var occurrence = DateTime.now();
    if (event.type == 'timed') {
      final date = await showDatePicker(
        context: context,
        initialDate: occurrence,
        firstDate: occurrence.subtract(const Duration(days: 7)),
        lastDate: occurrence,
      );
      if (date == null || !mounted) {
        return;
      }
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(occurrence),
        helpText: 'When did the event begin?',
      );
      if (time == null || !mounted) {
        return;
      }
      occurrence = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    } else {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(event.question),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Yes, record'),
            ),
          ],
        ),
      );
      if (confirm != true || !mounted) {
        return;
      }
    }
    setState(() => _saving = true);
    try {
      await EventsService.record(event, occurrence);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('${event.label} recorded.')));
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Events')),
    body: FutureBuilder<List<ClinicEvent>>(
      future: _events,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          if (snapshot.hasError) {
            return Center(child: Text('${snapshot.error}'));
          }
          return const Center(child: CircularProgressIndicator());
        }
        return ListView(
          children: snapshot.data!
              .map(
                (event) => ListTile(
                  title: Text(event.label),
                  subtitle: Text(event.question),
                  trailing: const Icon(Icons.add_circle_outline),
                  onTap: _saving ? null : () => _record(event),
                ),
              )
              .toList(),
        );
      },
    ),
  );
}
