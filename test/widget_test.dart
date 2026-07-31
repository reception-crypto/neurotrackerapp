import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/main.dart';
import 'package:neurotrackerapp/models/patient_profile.dart';
import 'package:neurotrackerapp/models/symptom_data.dart';
import 'package:neurotrackerapp/screens/home_screen.dart';
import 'package:neurotrackerapp/screens/privacy_screen.dart';
import 'package:neurotrackerapp/screens/settings_screen.dart';
import 'package:neurotrackerapp/services/identity_service.dart';
import 'package:neurotrackerapp/services/storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

const testProfile = PatientProfile(
  patientId: 'synthetic-patient',
  fullName: 'Synthetic Patient',
  primaryDisorder: 'Migraine',
  primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
  reminderTime: TimeOfDay(hour: 19, minute: 0),
  profileRevision: 1,
);

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    IdentityService.useInMemoryStorageForTesting = true;
    IdentityService.accessTokenForTesting = 'test-device-token';
  });

  test('Dysautonomia offers Pain and Weakness instead of retired symptoms', () {
    final symptoms = disorderSymptoms['Dysautonomia']!;

    expect(symptoms, containsAll(<String>['Pain', 'Weakness']));
    expect(symptoms, isNot(contains('Shortness of breath')));
    expect(symptoms, isNot(contains('Sweating changes')));
  });

  testWidgets('NeuroSol app starts', (WidgetTester tester) async {
    await tester.pumpWidget(const NeuroSolApp());
    await tester.pump();

    expect(find.text('NeuroSol Symptom Diary'), findsWidgets);
  });

  testWidgets('settings exposes the clinic profile as read-only', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    await tester.pumpWidget(const MaterialApp(home: SettingsScreen()));
    await tester.pumpAndSettle();

    expect(find.text('Clinic-assigned profile'), findsOneWidget);
    expect(find.text('Edit patient profile'), findsNothing);
    expect(
      find.textContaining('Contact the clinic to request changes'),
      findsOneWidget,
    );
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
    expect(
      find.textContaining('NeuroSol Symptom Diary allows'),
      findsOneWidget,
    );
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

  testWidgets('home offers one manual check-in when today is incomplete', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);

    await tester.pumpWidget(
      const MaterialApp(home: HomeScreen(profile: testProfile)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Today’s check-in is ready'), findsOneWidget);
    expect(find.byKey(const Key('start-daily-check-in')), findsOneWidget);

    await tester.tap(find.byKey(const Key('start-daily-check-in')));
    await tester.pumpAndSettle();

    expect(find.text('Daily Check-in'), findsOneWidget);
    expect(find.text('Today’s Symptoms'), findsOneWidget);
  });

  testWidgets('home locks check-in after today is complete', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    await StorageService.recordSubmissionDate(StorageService.localDateKey());

    await tester.pumpWidget(
      const MaterialApp(home: HomeScreen(profile: testProfile)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Today’s check-in is complete'), findsOneWidget);
    expect(find.byKey(const Key('start-daily-check-in')), findsNothing);
    expect(
      find.text('Your next check-in will be available tomorrow.'),
      findsOneWidget,
    );
  });

  testWidgets('ordinary app launch with a profile opens home', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    await StorageService.recordConsent(
      policyVersion: PrivacyScreen.policyVersion,
    );

    await tester.pumpWidget(const NeuroSolApp());
    await tester.pumpAndSettle();

    expect(find.text('Today’s check-in is ready'), findsOneWidget);
    expect(find.text('Today’s Symptoms'), findsNothing);
  });

  testWidgets('notification launch opens an incomplete daily check-in', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    await StorageService.recordConsent(
      policyVersion: PrivacyScreen.policyVersion,
    );

    await tester.pumpWidget(const NeuroSolApp(openCheckIn: true));
    await tester.pumpAndSettle();

    expect(find.text('Today’s Symptoms'), findsOneWidget);
  });

  testWidgets('notification launch cannot reopen a completed check-in', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    await StorageService.recordConsent(
      policyVersion: PrivacyScreen.policyVersion,
    );
    await StorageService.recordSubmissionDate(StorageService.localDateKey());

    await tester.pumpWidget(const NeuroSolApp(openCheckIn: true));
    await tester.pumpAndSettle();

    expect(find.text('Today’s check-in is complete'), findsOneWidget);
    expect(find.text('Today’s Symptoms'), findsNothing);
  });

  testWidgets('existing profile without a device token requires enrolment', (
    WidgetTester tester,
  ) async {
    IdentityService.accessTokenForTesting = null;
    await StorageService.saveProfile(testProfile);
    await StorageService.recordConsent(
      policyVersion: PrivacyScreen.policyVersion,
    );

    await tester.pumpWidget(const NeuroSolApp());
    await tester.pumpAndSettle();

    expect(find.text('Clinic Enrolment'), findsOneWidget);
    expect(find.text('Reconnect this phone'), findsOneWidget);
    expect(find.textContaining('Support ID:'), findsOneWidget);
    expect(find.text('Today’s Symptoms'), findsNothing);
  });

  testWidgets('a newer privacy policy requires renewed consent', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    await StorageService.recordConsent(policyVersion: 'older-policy');

    await tester.pumpWidget(const NeuroSolApp());
    await tester.pumpAndSettle();

    expect(find.text('Privacy and Consent'), findsOneWidget);
    expect(find.text('I consent'), findsOneWidget);
    expect(find.text('Today’s Symptoms'), findsNothing);
  });
}
