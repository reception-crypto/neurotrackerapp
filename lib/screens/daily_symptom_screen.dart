import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import '../theme/app_theme.dart';
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

  @override
  void initState() {
    super.initState();
    _refreshSyncStatus();
    scores = {
      for (final assignment in widget.profile.symptomAssignments)
        assignment.scoreKey: null,
    };
  }

  bool get _allSymptomsRated =>
      scores.isNotEmpty && scores.values.every((score) => score != null);

  @override
  Widget build(BuildContext context) {
    final assignments = widget.profile.symptomAssignments;
    final primaryAssignments = assignments
        .where((assignment) => assignment.track == 'Primary')
        .toList(growable: false);
    final secondaryAssignments = assignments
        .where((assignment) => assignment.track == 'Second')
        .toList(growable: false);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Check-in'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Step 1 of 2',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                InkWell(
                  onTap: _refreshSyncStatus,
                  borderRadius: BorderRadius.circular(20),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          pendingUploads == 0
                              ? Icons.cloud_done
                              : Icons.cloud_upload,
                          size: 18,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          pendingUploads == 0
                              ? 'Synced'
                              : '$pendingUploads pending',
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Today’s Symptoms',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Please rate each symptom below.\n0 = Not present\n10 = Worst it has been',
              style: Theme.of(
                context,
              ).textTheme.bodyLarge?.copyWith(color: AppTheme.secondaryText),
            ),
            const SizedBox(height: 18),
            Expanded(
              child: ListView(
                children: [
                  if (widget.profile.isIndependent) ...[
                    _IndependentProfileSummary(profile: widget.profile),
                    const SizedBox(height: 18),
                    _SymptomScoreSection(
                      sectionTitle: 'Symptoms to rate',
                      assignments: assignments,
                      scores: scores,
                      onScoreChanged: (key, value) =>
                          setState(() => scores[key] = value),
                    ),
                  ] else ...[
                    _SymptomScoreSection(
                      sectionTitle:
                          'Primary: ${widget.profile.primaryDisorder}',
                      assignments: primaryAssignments,
                      scores: scores,
                      onScoreChanged: (key, value) =>
                          setState(() => scores[key] = value),
                    ),
                    if (widget.profile.hasSecondaryDisorder) ...[
                      const SizedBox(height: 18),
                      _SymptomScoreSection(
                        sectionTitle:
                            'Second: ${widget.profile.secondaryDisorder}',
                        assignments: secondaryAssignments,
                        scores: scores,
                        onScoreChanged: (key, value) =>
                            setState(() => scores[key] = value),
                      ),
                    ],
                  ],
                ],
              ),
            ),
            SafeArea(
              minimum: const EdgeInsets.only(bottom: 20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _allSymptomsRated
                      ? () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => WellnessScreen(
                              profile: widget.profile,
                              symptomScores: scores,
                            ),
                          ),
                        )
                      : null,
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

class _IndependentProfileSummary extends StatelessWidget {
  final PatientProfile profile;

  const _IndependentProfileSummary({required this.profile});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Clinic-assigned disorders',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(profile.assignedDisorders.join(', ')),
            const SizedBox(height: 8),
            Text(
              'Each assigned symptom is rated once.',
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: AppTheme.secondaryText),
            ),
          ],
        ),
      ),
    );
  }
}

class _SymptomScoreSection extends StatelessWidget {
  final String sectionTitle;
  final List<AssignedSymptom> assignments;
  final Map<String, int?> scores;
  final void Function(String key, int value) onScoreChanged;

  const _SymptomScoreSection({
    required this.sectionTitle,
    required this.assignments,
    required this.scores,
    required this.onScoreChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(sectionTitle, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 10),
        ...assignments.map((assignment) {
          final scoreKey = assignment.scoreKey;
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    assignment.symptom.toUpperCase(),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
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
