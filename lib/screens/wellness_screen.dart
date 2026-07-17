import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/csv_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import '../theme/app_theme.dart';
import '../widgets/score_button.dart';
import 'daily_symptom_screen.dart';

class WellnessScreen extends StatefulWidget {
  final PatientProfile profile;
  final Map<String, int?> symptomScores;

  const WellnessScreen({
    super.key,
    required this.profile,
    required this.symptomScores,
  });

  @override
  State<WellnessScreen> createState() => _WellnessScreenState();
}

class _WellnessScreenState extends State<WellnessScreen> {
  int? wellnessPercent;
  bool submitting = false;

  Future<void> _submit() async {
    if (submitting) return;
    setState(() => submitting = true);

    final entry = CsvService.generateDailyEntry(
      profile: widget.profile,
      symptomScores: widget.symptomScores,
      wellnessPercent: wellnessPercent!,
    );
    if (await StorageService.hasSubmittedOn(entry.date)) {
      if (!mounted) return;
      setState(() => submitting = false);
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Already recorded today'),
          content: const Text(
            'A check-in has already been saved for today. Contact the clinic if it needs to be corrected.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }
    final rows = CsvService.rowsFromEntry(entry);

    await StorageService.saveEntryRows(rows);
    await StorageService.saveEntryToHistory(entry);
    await StorageService.recordSubmissionDate(entry.date);
    await StorageService.addPendingEntry(entry);
    final uploadResult = await UploadService.uploadDailyEntry(entry);
    final uploaded = uploadResult.succeeded;
    if (uploaded) await StorageService.removePendingEntry(entry.submissionId);
    final pending = await StorageService.pendingCount();

    if (!mounted) return;
    setState(() => submitting = false);
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(uploaded ? 'Check-in synced' : 'Check-in saved'),
        content: Text(
          uploaded
              ? 'Today’s check-in has been securely sent to the clinic.'
              : 'Today’s check-in is safely stored on this phone.\n\n${uploadResult.patientMessage}\n\nPending uploads: $pending',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );

    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) => DailySymptomScreen(profile: widget.profile),
      ),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Daily Check-in')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Step 2 of 2', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('Overall Wellness',
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            Text(
              'Thinking about your day as a whole, how well have you felt today?\n\n100% represents your best possible day.\n10% represents your worst possible day.',
              style: Theme.of(context)
                  .textTheme
                  .bodyLarge
                  ?.copyWith(color: AppTheme.secondaryText),
            ),
            const SizedBox(height: 26),
            Wrap(
              spacing: 10,
              runSpacing: 12,
              children: List.generate(10, (index) {
                final percent = (index + 1) * 10;
                return ScoreButton(
                  label: '$percent%',
                  width: 82,
                  selected: wellnessPercent == percent,
                  onPressed: () => setState(() => wellnessPercent = percent),
                );
              }),
            ),
            const Spacer(),
            SafeArea(
              minimum: const EdgeInsets.only(bottom: 20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: submitting || wellnessPercent == null ? null : _submit,
                  child: Text(submitting ? 'Saving…' : 'Submit'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
