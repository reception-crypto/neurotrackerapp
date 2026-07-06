import 'package:flutter/material.dart';

void main() {
  runApp(const NeuroTrackerApp());
}

class NeuroTrackerApp extends StatelessWidget {
  const NeuroTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NeuroTracker',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF123A63),
        ),
        useMaterial3: true,
      ),
      home: const ConsentScreen(),
    );
  }
}

const Map<String, List<String>> disorderSymptoms = {
  'Migraine': [
    'Headache',
    'Nausea',
    'Vomiting',
    'Light sensitivity',
    'Sound sensitivity',
    'Visual aura',
    'Neck pain',
    'Dizziness',
    'Brain fog',
    'Fatigue',
  ],
  'Dysautonomia': [
    'Dizziness',
    'Light-headedness',
    'Palpitations',
    'Fatigue',
    'Brain fog',
    'Shortness of breath',
    'Exercise intolerance',
    'Nausea',
    'Sweating changes',
    'Temperature intolerance',
  ],
  'CIDP': [
    'Weakness',
    'Numbness',
    'Tingling',
    'Pain',
    'Fatigue',
    'Balance problems',
    'Walking difficulty',
    'Hand clumsiness',
    'Falls',
    'Muscle cramps',
  ],
  'Myasthenia Gravis': [
    'Muscle weakness',
    'Double vision',
    'Drooping eyelids',
    'Difficulty swallowing',
    'Slurred speech',
    'Shortness of breath',
    'Chewing fatigue',
    'Neck weakness',
    'Arm weakness',
    'Leg weakness',
  ],
};

class PatientProfile {
  final String fullName;
  final String disorder;
  final List<String> symptoms;
  final TimeOfDay reminderTime;

  PatientProfile({
    required this.fullName,
    required this.disorder,
    required this.symptoms,
    required this.reminderTime,
  });
}

class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool consented = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NeuroTracker'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Privacy and Consent',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 20),
            const Text(
              'This app records your name, selected neurological condition, chosen symptoms, and daily symptom scores. '
              'This information is intended to assist your clinical care. It is not diagnostic and does not replace medical advice.',
              style: TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 20),
            const Text(
              'By continuing, you consent to this information being collected and stored for clinical monitoring purposes.',
              style: TextStyle(fontSize: 16),
            ),
            const Spacer(),
            CheckboxListTile(
              value: consented,
              onChanged: (value) {
                setState(() => consented = value ?? false);
              },
              title: const Text('I consent'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: consented
                    ? () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ProfileScreen(),
                          ),
                        );
                      }
                    : null,
                child: const Text('Continue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final nameController = TextEditingController();
  String selectedDisorder = 'Migraine';
  TimeOfDay reminderTime = const TimeOfDay(hour: 19, minute: 0);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Patient Profile'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            TextField(
              controller: nameController,
              decoration: const InputDecoration(
                labelText: 'Full name',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            DropdownButtonFormField<String>(
              value: selectedDisorder,
              decoration: const InputDecoration(
                labelText: 'Disorder',
                border: OutlineInputBorder(),
              ),
              items: disorderSymptoms.keys
                  .map(
                    (disorder) => DropdownMenuItem(
                      value: disorder,
                      child: Text(disorder),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                setState(() => selectedDisorder = value ?? 'Migraine');
              },
            ),
            const SizedBox(height: 20),
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
                if (picked != null) {
                  setState(() => reminderTime = picked);
                }
              },
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: nameController.text.trim().isEmpty
                    ? null
                    : () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => SymptomSelectionScreen(
                              fullName: nameController.text.trim(),
                              disorder: selectedDisorder,
                              reminderTime: reminderTime,
                            ),
                          ),
                        );
                      },
                child: const Text('Continue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SymptomSelectionScreen extends StatefulWidget {
  final String fullName;
  final String disorder;
  final TimeOfDay reminderTime;

  const SymptomSelectionScreen({
    super.key,
    required this.fullName,
    required this.disorder,
    required this.reminderTime,
  });

  @override
  State<SymptomSelectionScreen> createState() => _SymptomSelectionScreenState();
}

class _SymptomSelectionScreenState extends State<SymptomSelectionScreen> {
  final List<String> selectedSymptoms = [];

  @override
  Widget build(BuildContext context) {
    final symptoms = disorderSymptoms[widget.disorder] ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Choose 3 Symptoms'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(
              widget.disorder,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            const Text('Select exactly three symptoms to track.'),
            const SizedBox(height: 12),
            Expanded(
              child: ListView(
                children: symptoms.map((symptom) {
                  final selected = selectedSymptoms.contains(symptom);
                  return CheckboxListTile(
                    title: Text(symptom),
                    value: selected,
                    onChanged: (value) {
                      setState(() {
                        if (value == true) {
                          if (selectedSymptoms.length < 3) {
                            selectedSymptoms.add(symptom);
                          }
                        } else {
                          selectedSymptoms.remove(symptom);
                        }
                      });
                    },
                  );
                }).toList(),
              ),
            ),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: selectedSymptoms.length == 3
                    ? () {
                        final profile = PatientProfile(
                          fullName: widget.fullName,
                          disorder: widget.disorder,
                          symptoms: selectedSymptoms,
                          reminderTime: widget.reminderTime,
                        );

                        Navigator.pushAndRemoveUntil(
                          context,
                          MaterialPageRoute(
                            builder: (_) => DailyRatingScreen(profile: profile),
                          ),
                          (_) => false,
                        );
                      }
                    : null,
                child: const Text('Finish Setup'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class DailyRatingScreen extends StatefulWidget {
  final PatientProfile profile;

  const DailyRatingScreen({
    super.key,
    required this.profile,
  });

  @override
  State<DailyRatingScreen> createState() => _DailyRatingScreenState();
}

class _DailyRatingScreenState extends State<DailyRatingScreen> {
  late Map<String, double> scores;

  @override
  void initState() {
    super.initState();
    scores = {
      for (final symptom in widget.profile.symptoms) symptom: 0,
    };
  }

  @override
  Widget build(BuildContext context) {
    final burdenScore = scores.values.fold<double>(0, (a, b) => a + b);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Today’s Symptoms'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(
              widget.profile.fullName,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            Text(widget.profile.disorder),
            const SizedBox(height: 24),
            Expanded(
              child: ListView(
                children: widget.profile.symptoms.map((symptom) {
                  final value = scores[symptom] ?? 0;
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            symptom,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Slider(
                            min: 0,
                            max: 10,
                            divisions: 10,
                            label: value.round().toString(),
                            value: value,
                            onChanged: (newValue) {
                              setState(() => scores[symptom] = newValue);
                            },
                          ),
                          Text('${value.round()} / 10'),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
            Text(
              'Daily burden score: ${burdenScore.round()} / 30',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  final csvRow = _generateCsvRow(widget.profile, scores);

                  showDialog(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: const Text('Saved'),
                      content: Text(
                        'Today’s symptoms were recorded.\n\nCSV row:\n$csvRow',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('OK'),
                        ),
                      ],
                    ),
                  );
                },
                child: const Text('Submit'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _generateCsvRow(PatientProfile profile, Map<String, double> scores) {
    final now = DateTime.now().toIso8601String();

    return [
      now,
      profile.fullName,
      profile.disorder,
      profile.symptoms[0],
      scores[profile.symptoms[0]]!.round(),
      profile.symptoms[1],
      scores[profile.symptoms[1]]!.round(),
      profile.symptoms[2],
      scores[profile.symptoms[2]]!.round(),
      scores.values.fold<double>(0, (a, b) => a + b).round(),
    ].join(',');
  }
}