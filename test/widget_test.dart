import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/main.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
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

const independentTestProfile = PatientProfile(
  patientId: 'synthetic-independent-patient',
  fullName: 'Independent Patient',
  schemaVersion: 3,
  disorderIds: ['migraine', 'dysautonomia'],
  disorders: ['Migraine', 'Dysautonomia'],
  symptomIds: ['headache', 'weakness', 'pain', 'vertigo'],
  symptoms: ['Headache', 'Weakness', 'Pain', 'Vertigo'],
  reminderTime: TimeOfDay(hour: 19, minute: 0),
  profileRevision: 2,
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

    expect(find.byKey(const Key('neurosol-brand-banner')), findsOneWidget);
    expect(find.text('SYMPTOM DIARY'), findsOneWidget);
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

  testWidgets('settings separates assigned disorders from symptoms', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(independentTestProfile);
    await tester.pumpWidget(const MaterialApp(home: SettingsScreen()));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Disorders: Migraine, Dysautonomia'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Symptoms: Headache, Weakness, Pain, Vertigo'),
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

    final today = StorageService.localDateKey();
    expect(find.text('Choose check-in date'), findsOneWidget);
    await tester.tap(find.byKey(Key('check-in-date-$today')));
    await tester.pumpAndSettle();

    expect(find.text('Daily Check-in'), findsOneWidget);
    expect(find.byKey(const Key('check-in-selected-date')), findsOneWidget);
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
    expect(find.byKey(const Key('start-daily-check-in')), findsOneWidget);
    expect(
      find.textContaining('record a missed day from the previous 7 days'),
      findsOneWidget,
    );
  });

  testWidgets('independent check-in rates each symptom once', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(independentTestProfile);

    await tester.pumpWidget(
      const MaterialApp(home: HomeScreen(profile: independentTestProfile)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('start-daily-check-in')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(Key('check-in-date-${StorageService.localDateKey()}')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Clinic-assigned disorders'), findsOneWidget);
    expect(find.text('Migraine, Dysautonomia'), findsOneWidget);
    expect(find.text('Each assigned symptom is rated once.'), findsOneWidget);
    expect(find.text('HEADACHE'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('VERTIGO'),
      400,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('VERTIGO'), findsOneWidget);
    expect(find.textContaining('Primary:'), findsNothing);
    expect(find.textContaining('Second:'), findsNothing);
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
    expect(find.byKey(const Key('check-in-selected-date')), findsNothing);
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

    expect(find.byKey(const Key('check-in-selected-date')), findsOneWidget);
  });

  testWidgets('patient diary shows 30, 60 and 90 day line graphs', (
    WidgetTester tester,
  ) async {
    await StorageService.saveProfile(testProfile);
    final today = StorageService.localDateKey();
    await StorageService.saveEntryToHistory(
      DailyEntry(
        submissionId: 'diary-widget-entry',
        patientId: testProfile.patientId,
        date: today,
        time: '19:00',
        patientName: testProfile.fullName,
        records: const [
          SymptomScoreRecord(
            track: 'Primary',
            disorder: 'Migraine',
            symptom: 'Headache',
            score: 4,
          ),
        ],
        wellnessPercent: 70,
      ),
    );

    await tester.pumpWidget(
      const MaterialApp(home: HomeScreen(profile: testProfile)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Patient diary'));
    await tester.pumpAndSettle();

    expect(find.text('Overall wellness'), findsOneWidget);
    expect(find.text('Symptoms'), findsOneWidget);
    expect(find.text('30 days'), findsOneWidget);
    expect(find.text('60 days'), findsOneWidget);
    expect(find.text('90 days'), findsOneWidget);
    expect(find.byType(CustomPaint), findsWidgets);
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
