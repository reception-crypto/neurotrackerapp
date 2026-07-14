import 'package:flutter/material.dart';

class PatientProfile {
  final String fullName;
  final String primaryDisorder;
  final List<String> primarySymptoms;
  final String? secondaryDisorder;
  final List<String> secondarySymptoms;
  final TimeOfDay reminderTime;

  const PatientProfile({
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
      fullName: fullName,
      primaryDisorder: primaryDisorder,
      primarySymptoms: primarySymptoms,
      secondaryDisorder: secondaryDisorder,
      secondarySymptoms: secondarySymptoms,
      reminderTime: reminderTime ?? this.reminderTime,
    );
  }

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
    final oldDisorder = json['disorder'] as String?;
    final oldSymptoms = json['symptoms'];

    return PatientProfile(
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
}
