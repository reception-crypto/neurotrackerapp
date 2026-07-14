import 'package:flutter/material.dart';

import 'screens/startup_screen.dart';
import 'services/notification_service.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.initialise();
  runApp(const NeuroTrackerApp());
}

class NeuroTrackerApp extends StatelessWidget {
  const NeuroTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NeuroTracker Clinical',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkBlueTheme,
      home: const StartupScreen(),
    );
  }
}
