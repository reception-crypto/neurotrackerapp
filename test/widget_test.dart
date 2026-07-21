import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/main.dart';
import 'package:neurotrackerapp/screens/profile_screen.dart';

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
    await tester.pumpAndSettle();

    final continueFinder = find.widgetWithText(FilledButton, 'Continue');
    final continueButton = tester.widget<FilledButton>(continueFinder);
    expect(continueButton.onPressed, isNotNull);

    await tester.tap(continueFinder);
    await tester.pumpAndSettle();

    expect(find.text('Choose Symptoms'), findsOneWidget);
    expect(find.text('Primary: Migraine'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
