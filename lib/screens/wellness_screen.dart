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
  final Map<String, int> symptomScores;

  const WellnessScreen({
    super.key,
    required this.profile,
    required this.symptomScores,
  });

  @override
  State<WellnessScreen> createState() => _WellnessScreenState();
}

class _WellnessScreenState extends State<WellnessScreen> {
  int wellnessPercent = 50;

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
            Text('Overall Wellness', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            Text(
              'Thinking about your day as a whole, how well have you felt today?\n\n100% represents your best possible day.\n10% represents your worst possible day.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: AppTheme.secondaryText),
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
                  onPressed: () async {
                    final entry = CsvService.generateDailyEntry(
                      profile: widget.profile,
                      symptomScores: widget.symptomScores,
                      wellnessPercent: wellnessPercent,
                    );
                    final rows = CsvService.rowsFromEntry(entry);

                    for (final row in rows) {
                      await StorageService.saveEntry(row);
                    }

                    final uploaded = await UploadService.uploadDailyEntry(entry);

                    if (!context.mounted) return;
                    showDialog(
                      context: context,
                      builder: (_) => AlertDialog(
                        title: Text(uploaded ? 'Saved and Uploaded' : 'Saved Locally'),
                        content: Text(
                          uploaded
                              ? 'Today’s check-in was recorded and uploaded to the clinic database.\n\n${rows.join('\n')}'
                              : 'Today’s check-in was recorded on this phone, but the clinic database could not be reached.\n\n${rows.join('\n')}',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () {
                              Navigator.pop(context);
                              Navigator.pushAndRemoveUntil(
                                context,
                                MaterialPageRoute(builder: (_) => DailySymptomScreen(profile: widget.profile)),
                                (_) => false,
                              );
                            },
                            child: const Text('OK'),
                          ),
                        ],
                      ),
                    );
                  },
                  child: const Text('Submit'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
