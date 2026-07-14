import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/storage_service.dart';
import 'consent_screen.dart';
import 'daily_symptom_screen.dart';

class StartupScreen extends StatefulWidget {
  const StartupScreen({super.key});

  @override
  State<StartupScreen> createState() => _StartupScreenState();
}

class _StartupScreenState extends State<StartupScreen> {
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final PatientProfile? profile = await StorageService.loadProfile();
    if (!mounted) return;

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => profile == null
            ? const ConsentScreen()
            : DailySymptomScreen(profile: profile),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}
