import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../models/symptom_data.dart';
import 'symptom_selection_screen.dart';

class ProfileScreen extends StatefulWidget {
  final PatientProfile? initialProfile;

  const ProfileScreen({super.key, this.initialProfile});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final nameController = TextEditingController();
  String primaryDisorder = 'Migraine';
  bool useSecondDisorder = false;
  String secondaryDisorder = 'Dysautonomia';
  TimeOfDay reminderTime = const TimeOfDay(hour: 19, minute: 0);

  @override
  void initState() {
    super.initState();
    final initial = widget.initialProfile;
    if (initial != null) {
      nameController.text = initial.fullName;
      primaryDisorder = initial.primaryDisorder;
      useSecondDisorder = initial.hasSecondaryDisorder;
      secondaryDisorder = initial.secondaryDisorder ?? 'Dysautonomia';
      reminderTime = initial.reminderTime;
    }
    nameController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    nameController.dispose();
    super.dispose();
  }

  List<DropdownMenuItem<String>> get disorderItems => disorderSymptoms.keys
      .map((disorder) => DropdownMenuItem(value: disorder, child: Text(disorder)))
      .toList();

  bool get canContinue =>
      nameController.text.trim().isNotEmpty &&
      (!useSecondDisorder || secondaryDisorder != primaryDisorder);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patient Profile')),
      body: SafeArea(
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Setup', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 20),
              TextField(
                controller: nameController,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(labelText: 'Full name'),
              ),
              const SizedBox(height: 20),
              DropdownButtonFormField<String>(
                initialValue: primaryDisorder,
                decoration: const InputDecoration(labelText: 'Primary disorder'),
                dropdownColor: const Color(0xFF2A2A2A),
                items: disorderItems,
                onChanged: (value) => setState(() => primaryDisorder = value ?? 'Migraine'),
              ),
              const SizedBox(height: 12),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: useSecondDisorder,
                onChanged: (value) => setState(() => useSecondDisorder = value ?? false),
                title: const Text('Track a second disorder'),
                subtitle: const Text(
                  'Optional. Patients still select three symptoms for each disorder.',
                ),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              if (useSecondDisorder) ...[
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  key: ValueKey(secondaryDisorder),
                  initialValue: secondaryDisorder,
                  decoration: const InputDecoration(labelText: 'Second disorder'),
                  dropdownColor: const Color(0xFF2A2A2A),
                  items: disorderItems,
                  onChanged: (value) => setState(
                    () => secondaryDisorder = value ?? 'Dysautonomia',
                  ),
                ),
                if (secondaryDisorder == primaryDisorder)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text(
                      'Choose a different second disorder.',
                      style: TextStyle(color: Colors.orangeAccent),
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Daily reminder time'),
                subtitle: Text(reminderTime.format(context)),
                trailing: const Icon(Icons.schedule),
                onTap: () async {
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: reminderTime,
                  );
                  if (picked != null) setState(() => reminderTime = picked);
                },
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: !canContinue
                      ? null
                      : () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => SymptomSelectionScreen(
                                patientId: widget.initialProfile?.patientId,
                                fullName: nameController.text.trim(),
                                primaryDisorder: primaryDisorder,
                                secondaryDisorder:
                                    useSecondDisorder ? secondaryDisorder : null,
                                reminderTime: reminderTime,
                                initialPrimarySymptoms:
                                    widget.initialProfile?.primaryDisorder ==
                                            primaryDisorder
                                        ? widget.initialProfile!.primarySymptoms
                                        : const [],
                                initialSecondarySymptoms:
                                    widget.initialProfile?.secondaryDisorder ==
                                            (useSecondDisorder ? secondaryDisorder : null)
                                        ? widget.initialProfile!.secondarySymptoms
                                        : const [],
                              ),
                            ),
                          ),
                  child: const Text('Continue'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
