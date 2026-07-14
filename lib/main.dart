import 'package:flutter/material.dart';

import 'theme/app_theme.dart';
import 'screens/startup_screen.dart';

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
      theme: AppTheme.darkBlueTheme,
      home: const StartupScreen(),
    );
  }
}
