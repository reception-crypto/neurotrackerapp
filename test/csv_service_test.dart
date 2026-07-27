import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/models/daily_entry.dart';
import 'package:neurotrackerapp/models/patient_profile.dart';
import 'package:neurotrackerapp/services/csv_service.dart';

void main() {
  test('support ID is a shortened stable representation of PatientId', () {
    const profile = PatientProfile(
      patientId: 'pt-12345678-abcd-90ef',
      fullName: 'Synthetic Patient',
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
      reminderTime: TimeOfDay(hour: 19, minute: 0),
    );

    expect(profile.supportId, 'NS-5678-ABCD-90EF');
  });

  test('local CSV includes PatientId on every new row', () {
    const entry = DailyEntry(
      submissionId: 'NS-test',
      patientId: 'pt-clinic-123',
      date: '2026-07-27',
      time: '19:00',
      patientName: 'Synthetic Patient',
      records: [
        SymptomScoreRecord(
          track: 'Primary',
          disorder: 'Migraine',
          symptom: 'Headache',
          score: 3,
        ),
      ],
      wellnessPercent: 70,
    );

    final csv = CsvService.buildCsv(CsvService.rowsFromEntry(entry));

    expect(csv.split('\n').first, endsWith(',PatientId'));
    expect(csv.split('\n').last, endsWith(',pt-clinic-123'));
  });

  test('legacy Build 5 CSV rows remain aligned with a blank PatientId', () {
    const legacyRow =
        'NS-old,2026-07-26,19:00,"Patient, Synthetic",Primary,Migraine,Headache,4,80';

    final csv = CsvService.buildCsv([legacyRow]);

    expect(csv.split('\n').last, endsWith(',80,'));
  });

  test('a check-in cannot be generated before clinic enrolment', () {
    const profile = PatientProfile(
      patientId: '',
      fullName: 'Synthetic Patient',
      primaryDisorder: 'Migraine',
      primarySymptoms: ['Headache', 'Nausea', 'Vomiting'],
      reminderTime: TimeOfDay(hour: 19, minute: 0),
    );

    expect(
      () => CsvService.generateDailyEntry(
        profile: profile,
        symptomScores: const {
          'Primary|Migraine|Headache': 1,
          'Primary|Migraine|Nausea': 2,
          'Primary|Migraine|Vomiting': 3,
        },
        wellnessPercent: 70,
      ),
      throwsStateError,
    );
  });
}
