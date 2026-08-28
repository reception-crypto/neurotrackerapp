import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/services/clinic_profile_service.dart';
import 'package:neurotrackerapp/services/identity_service.dart';

void main() {
  test('Build 9 accepts an additive backend that still supports Build 7', () {
    const current = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 8,
      googlePlayUrl: '',
      appStoreUrl: '',
    );
    const newerAvailable = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 10,
      googlePlayUrl: '',
      appStoreUrl: '',
    );

    expect(current.updateRequired, isFalse);
    expect(newerAvailable.updateRequired, isTrue);
  });

  test('mobile requests advertise every Build 9 capability', () {
    final headers = IdentityService.mobileHeaders(
      json: true,
      accessToken: 'synthetic-token',
    );

    expect(headers['X-NeuroSol-Build'], '9');
    expect(headers['X-NeuroSol-Profile'], 'clinic-managed-v1');
    expect(headers['X-NeuroSol-Disorders'], 'canonical-v1');
    expect(headers['X-NeuroSol-Profile-Model'], 'independent-v1');
    expect(headers['X-NeuroSol-Diary'], 'patient-diary-v1');
    expect(
      int.tryParse(headers['X-NeuroSol-UTC-Offset-Minutes'] ?? ''),
      inInclusiveRange(-840, 840),
    );
    expect(headers['Authorization'], 'Bearer synthetic-token');
    expect(headers['Content-Type'], 'application/json');
  });
}
