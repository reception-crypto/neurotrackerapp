import 'package:flutter/material.dart';

import 'app_identity.dart';
import 'screens/startup_screen.dart';
import 'services/notification_service.dart';
import 'theme/app_theme.dart';

final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.initialise();
  final initialPayload = NotificationService.takeLaunchPayload();
  NotificationService.setNotificationTapHandler((payload) {
    if (payload != NotificationService.dailyCheckInPayload) return;
    appNavigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const StartupScreen(openCheckIn: true)),
      (_) => false,
    );
  });
  runApp(
    NeuroSolApp(
      openCheckIn: initialPayload == NotificationService.dailyCheckInPayload,
    ),
  );
}

class NeuroSolApp extends StatelessWidget {
  final bool openCheckIn;

  const NeuroSolApp({super.key, this.openCheckIn = false});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: appNavigatorKey,
      title: appDisplayName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkBlueTheme,
      home: StartupScreen(openCheckIn: openCheckIn),
    );
  }
}
