import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../theme/app_theme.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import '../widgets/score_button.dart';
import 'settings_screen.dart';
import 'wellness_screen.dart';

class DailySymptomScreen extends StatefulWidget {
  final PatientProfile profile;

  const DailySymptomScreen({super.key, required this.profile});

  @override
  State<DailySymptomScreen> createState() => _DailySymptomScreenState();
}

class _DailySymptomScreenState extends State<DailySymptomScreen> {
  late Map<String, int?> scores;
  int pendingUploads = 0;

  Future<void> _refreshSyncStatus() async {
    await UploadService.retryPendingUploads();
    final count = await StorageService.pendingCount();
    if (mounted) setState(() => pendingUploads = count);
  }

  String _key(String track, String disorder, String symptom) => '$track|$disorder|$symptom';

  @override
  void initState() {
    super.initState();
    _refreshSyncStatus();
    scores = {};
    for (final symptom in widget.profile.primarySymptoms) {
      scores[_key('Primary', widget.profile.primaryDisorder, symptom)] = null;
    }
    if (widget.profile.hasSecondaryDisorder) {
      for (final symptom in widget.profile.secondarySymptoms) {
        scores[_key('Second', widget.profile.secondaryDisorder!, symptom)] = null;
      }
    }
  }

  bool get _allSymptomsRated =>
      scores.isNotEmpty && scores.values.every((score) => score != null);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Check-in'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen())),
          )
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text('Step 1 of 2', style: Theme.of(context).textTheme.titleLarge)),
                InkWell(
                  onTap: _refreshSyncStatus,
                  borderRadius: BorderRadius.circular(20),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          pendingUploads == 0 ? Icons.cloud_done : Icons.cloud_upload,
                          size: 18,
                        ),
                        const SizedBox(width: 6),
                        Text(pendingUploads == 0 ? 'Synced' : '$pendingUploads pending'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('Today’s Symptoms', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(
              'Please rate each symptom below.\n0 = Not present\n10 = Worst it has been',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: AppTheme.secondaryText),
            ),
            const SizedBox(height: 18),
            Expanded(
              child: ListView(
                children: [
                  _DisorderScoreSection(
                    sectionTitle: 'Primary: ${widget.profile.primaryDisorder}',
                    disorder: widget.profile.primaryDisorder,
                    symptoms: widget.profile.primarySymptoms,
                    track: 'Primary',
                    scores: scores,
                    keyBuilder: _key,
                    onScoreChanged: (key, value) => setState(() => scores[key] = value),
                  ),
                  if (widget.profile.hasSecondaryDisorder) ...[
                    const SizedBox(height: 18),
                    _DisorderScoreSection(
                      sectionTitle: 'Second: ${widget.profile.secondaryDisorder}',
                      disorder: widget.profile.secondaryDisorder!,
                      symptoms: widget.profile.secondarySymptoms,
                      track: 'Second',
                      scores: scores,
                      keyBuilder: _key,
                      onScoreChanged: (key, value) => setState(() => scores[key] = value),
                    ),
                  ],
                ],
              ),
            ),
            SafeArea(
              minimum: const EdgeInsets.only(bottom: 20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _allSymptomsRated ? () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => WellnessScreen(profile: widget.profile, symptomScores: scores),
                    ),
                  ) : null,
                  child: const Text('Next'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DisorderScoreSection extends StatelessWidget {
  final String sectionTitle;
  final String track;
  final String disorder;
  final List<String> symptoms;
  final Map<String, int?> scores;
  final String Function(String track, String disorder, String symptom) keyBuilder;
  final void Function(String key, int value) onScoreChanged;

  const _DisorderScoreSection({
    required this.sectionTitle,
    required this.track,
    required this.disorder,
    required this.symptoms,
    required this.scores,
    required this.keyBuilder,
    required this.onScoreChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(sectionTitle, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 10),
        ...symptoms.map((symptom) {
          final scoreKey = keyBuilder(track, disorder, symptom);
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(symptom.toUpperCase(), style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 10,
                    children: List.generate(11, (index) {
                      return ScoreButton(
                        label: index.toString(),
                        selected: scores[scoreKey] == index,
                        onPressed: () => onScoreChanged(scoreKey, index),
                      );
                    }),
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}
