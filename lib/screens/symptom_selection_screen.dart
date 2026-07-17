import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../models/symptom_data.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
import 'daily_symptom_screen.dart';

class SymptomSelectionScreen extends StatefulWidget {
  final String? patientId;
  final String fullName;
  final String primaryDisorder;
  final String? secondaryDisorder;
  final TimeOfDay reminderTime;
  final List<String> initialPrimarySymptoms;
  final List<String> initialSecondarySymptoms;

  const SymptomSelectionScreen({
    super.key,
    this.patientId,
    required this.fullName,
    required this.primaryDisorder,
    required this.secondaryDisorder,
    required this.reminderTime,
    this.initialPrimarySymptoms = const [],
    this.initialSecondarySymptoms = const [],
  });

  @override
  State<SymptomSelectionScreen> createState() =>
      _SymptomSelectionScreenState();
}

class _SymptomSelectionScreenState extends State<SymptomSelectionScreen> {
  late final List<String> primarySymptoms;
  late final List<String> secondarySymptoms;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    primarySymptoms = List<String>.from(widget.initialPrimarySymptoms);
    secondarySymptoms = List<String>.from(widget.initialSecondarySymptoms);
  }

  bool get requiresSecondary =>
      widget.secondaryDisorder != null &&
      widget.secondaryDisorder!.isNotEmpty;

  bool get canFinish =>
      primarySymptoms.length == 3 &&
      (!requiresSecondary || secondarySymptoms.length == 3);

  Future<void> _finishSetup() async {
    if (!canFinish || _saving) return;

    setState(() => _saving = true);

    try {
      final profile = PatientProfile(
        patientId: widget.patientId ?? PatientProfile.generatePatientId(),
        fullName: widget.fullName,
        primaryDisorder: widget.primaryDisorder,
        primarySymptoms: List<String>.from(primarySymptoms),
        secondaryDisorder:
            requiresSecondary ? widget.secondaryDisorder : null,
        secondarySymptoms: requiresSecondary
            ? List<String>.from(secondarySymptoms)
            : const [],
        reminderTime: widget.reminderTime,
      );

      await StorageService.saveProfile(profile);

      final permissionGranted =
          await NotificationService.requestPermission();

      if (permissionGranted) {
        await NotificationService.scheduleDailyReminder(
          hour: widget.reminderTime.hour,
          minute: widget.reminderTime.minute,
        );
      }

      if (!mounted) return;

      if (!permissionGranted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Profile saved. Notifications are currently disabled and can be enabled in phone settings.',
            ),
          ),
        );
      }

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(
          builder: (_) => DailySymptomScreen(profile: profile),
        ),
        (_) => false,
      );
    } catch (error) {
      if (!mounted) return;

      setState(() => _saving = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Setup could not be completed: $error'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose Symptoms')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Select symptoms',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 10),
            Text(
              requiresSecondary
                  ? 'Select exactly three symptoms for each disorder.'
                  : 'Select exactly three symptoms to track.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: ListView(
                children: [
                  _SymptomChecklist(
                    title: 'Primary: ${widget.primaryDisorder}',
                    disorder: widget.primaryDisorder,
                    selectedSymptoms: primarySymptoms,
                    onChanged: () => setState(() {}),
                  ),
                  if (requiresSecondary) ...[
                    const SizedBox(height: 24),
                    _SymptomChecklist(
                      title: 'Second: ${widget.secondaryDisorder}',
                      disorder: widget.secondaryDisorder!,
                      selectedSymptoms: secondarySymptoms,
                      onChanged: () => setState(() {}),
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
                  onPressed: canFinish && !_saving ? _finishSetup : null,
                  child: _saving
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                          ),
                        )
                      : const Text('Finish Setup'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SymptomChecklist extends StatelessWidget {
  final String title;
  final String disorder;
  final List<String> selectedSymptoms;
  final VoidCallback onChanged;

  const _SymptomChecklist({
    required this.title,
    required this.disorder,
    required this.selectedSymptoms,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final symptoms = disorderSymptoms[disorder] ?? [];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 6),
            Text('${selectedSymptoms.length}/3 selected'),
            const SizedBox(height: 8),
            ...symptoms.map((symptom) {
              final selected = selectedSymptoms.contains(symptom);

              return CheckboxListTile(
                title: Text(symptom),
                value: selected,
                onChanged: (value) {
                  if (value == true) {
                    if (selectedSymptoms.length < 3) {
                      selectedSymptoms.add(symptom);
                    }
                  } else {
                    selectedSymptoms.remove(symptom);
                  }

                  onChanged();
                },
              );
            }),
          ],
        ),
      ),
    );
  }
}
