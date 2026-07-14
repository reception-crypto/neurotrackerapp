import 'package:flutter/material.dart';

class PatientProfile {
  final String fullName;
  final String primaryDisorder;
  final List<String> primarySymptoms;
  final String? secondaryDisorder;
  final List<String> secondarySymptoms;
  final TimeOfDay reminderTime;

  PatientProfile({
    required this.fullName,
    required this.primaryDisorder,
    required this.primarySymptoms,
    this.secondaryDisorder,
    this.secondarySymptoms = const [],
    required this.reminderTime,
  });

  bool get hasSecondaryDisorder =>
      secondaryDisorder != null && secondaryDisorder!.isNotEmpty && secondarySymptoms.isNotEmpty;

  Map<String, dynamic> toJson() => {
        'fullName': fullName,
        'primaryDisorder': primaryDisorder,
        'primarySymptoms': primarySymptoms,
        'secondaryDisorder': secondaryDisorder,
        'secondarySymptoms': secondarySymptoms,
        'reminderHour': reminderTime.hour,
        'reminderMinute': reminderTime.minute,
      };

  factory PatientProfile.fromJson(Map<String, dynamic> json) {
    // Backwards compatibility with earlier single-disorder beta profiles.
    final oldDisorder = json['disorder'] as String?;
    final oldSymptoms = json['symptoms'];

    return PatientProfile(
      fullName: json['fullName'] as String,
      primaryDisorder: (json['primaryDisorder'] as String?) ?? oldDisorder ?? 'Migraine',
      primarySymptoms: List<String>.from(
        (json['primarySymptoms'] as List?) ?? oldSymptoms as List? ?? const [],
      ),
      secondaryDisorder: json['secondaryDisorder'] as String?,
      secondarySymptoms: List<String>.from((json['secondarySymptoms'] as List?) ?? const []),
      reminderTime: TimeOfDay(
        hour: json['reminderHour'] as int,
        minute: json['reminderMinute'] as int,
      ),
    );
  }
}
