import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/main.dart';
import 'package:neurotrackerapp/screens/profile_screen.dart';
import 'package:neurotrackerapp/screens/settings_screen.dart';

void main() {
  testWidgets('NeuroTracker app starts', (WidgetTester tester) async {
    await tester.pumpWidget(const NeuroTrackerApp());
    await tester.pump();

    expect(find.text('NeuroTracker Clinical'), findsWidgets);
  });

  testWidgets('new profile can continue with one disorder', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: ProfileScreen()));

    await tester.enterText(
      find.byType(EditableText).first,
      'Synthetic Patient',
    );
    await tester.pump();

    final continueButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Continue'),
    );
    expect(continueButton.onPressed, isNotNull);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Choose Symptoms'), findsOneWidget);
    expect(find.text('Primary: Migraine'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('privacy information remains accessible from settings', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: SettingsScreen()));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Privacy and app information'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Privacy and app information'));
    await tester.pumpAndSettle();

    expect(find.text('Information collected'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('This app is not a medical device'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.textContaining('This app is not a medical device'),
      findsOneWidget,
    );
    await tester.scrollUntilVisible(
      find.textContaining('reception@pascoeneurology.com'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.textContaining('reception@pascoeneurology.com'),
      findsOneWidget,
    );
  });
}
