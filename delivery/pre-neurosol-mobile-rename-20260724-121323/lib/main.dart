import 'package:flutter/material.dart';

import 'screens/startup_screen.dart';
import 'services/notification_service.dart';
import 'theme/app_theme.dart';

final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.initialise();
  NotificationService.setNotificationTapHandler((payload) {
    if (payload != 'daily_check_in') return;
    appNavigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const StartupScreen()),
      (_) => false,
    );
  });
  runApp(const NeuroTrackerApp());
}

class NeuroTrackerApp extends StatelessWidget {
  const NeuroTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: appNavigatorKey,
      title: 'NeuroTracker Clinical',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkBlueTheme,
      home: const StartupScreen(),
    );
  }
}
