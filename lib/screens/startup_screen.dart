import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
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
    if (profile != null) {
      await NotificationService.scheduleDailyReminder(
  hour: profile.reminderTime.hour,
  minute: profile.reminderTime.minute,
);
      await UploadService.retryPendingUploads();
    }
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
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/icon/app_icon.png', width: 112, height: 112),
            const SizedBox(height: 18),
            Text('NeuroTracker Clinical',
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 22),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
