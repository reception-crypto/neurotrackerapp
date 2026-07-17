import 'dart:math';

import 'package:flutter/material.dart';

class PatientProfile {
  final String patientId;
  final String fullName;
  final String primaryDisorder;
  final List<String> primarySymptoms;
  final String? secondaryDisorder;
  final List<String> secondarySymptoms;
  final TimeOfDay reminderTime;

  const PatientProfile({
    required this.patientId,
    required this.fullName,
    required this.primaryDisorder,
    required this.primarySymptoms,
    this.secondaryDisorder,
    this.secondarySymptoms = const [],
    required this.reminderTime,
  });

  bool get hasSecondaryDisorder =>
      secondaryDisorder != null &&
      secondaryDisorder!.isNotEmpty &&
      secondarySymptoms.isNotEmpty;

  PatientProfile copyWith({TimeOfDay? reminderTime}) {
    return PatientProfile(
      patientId: patientId,
      fullName: fullName,
      primaryDisorder: primaryDisorder,
      primarySymptoms: primarySymptoms,
      secondaryDisorder: secondaryDisorder,
      secondarySymptoms: secondarySymptoms,
      reminderTime: reminderTime ?? this.reminderTime,
    );
  }

  Map<String, dynamic> toJson() => {
        'patientId': patientId,
        'fullName': fullName,
        'primaryDisorder': primaryDisorder,
        'primarySymptoms': primarySymptoms,
        'secondaryDisorder': secondaryDisorder,
        'secondarySymptoms': secondarySymptoms,
        'reminderHour': reminderTime.hour,
        'reminderMinute': reminderTime.minute,
      };

  factory PatientProfile.fromJson(Map<String, dynamic> json) {
    final oldDisorder = json['disorder'] as String?;
    final oldSymptoms = json['symptoms'];

    return PatientProfile(
      patientId: (json['patientId'] as String?)?.trim().isNotEmpty == true
          ? json['patientId'] as String
          : generatePatientId(),
      fullName: json['fullName'] as String? ?? '',
      primaryDisorder:
          (json['primaryDisorder'] as String?) ?? oldDisorder ?? 'Migraine',
      primarySymptoms: List<String>.from(
        (json['primarySymptoms'] as List?) ?? oldSymptoms as List? ?? const [],
      ),
      secondaryDisorder: json['secondaryDisorder'] as String?,
      secondarySymptoms:
          List<String>.from((json['secondarySymptoms'] as List?) ?? const []),
      reminderTime: TimeOfDay(
        hour: (json['reminderHour'] as num?)?.toInt() ?? 19,
        minute: (json['reminderMinute'] as num?)?.toInt() ?? 0,
      ),
    );
  }

  static String generatePatientId() {
    final random = Random.secure();
    final timestamp = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    final suffix = List.generate(
      16,
      (_) => random.nextInt(36).toRadixString(36),
    ).join();
    return 'pt-$timestamp-$suffix';
  }
}
