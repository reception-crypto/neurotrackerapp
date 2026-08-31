import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/services/clinic_profile_service.dart';
import 'package:neurotrackerapp/services/identity_service.dart';

void main() {
  test('newer builds are advisory while Build 9 remains supported', () {
    const supported = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 10,
      googlePlayUrl: '',
      appStoreUrl: '',
    );

    expect(supported.updateRequired, isFalse);
    expect(supported.updateAvailable, isTrue);
  });

  test('minimum build is the hard compatibility gate', () {
    const unsupported = MobileConfiguration(
      minimumBuild: 10,
      latestBuild: 10,
      googlePlayUrl: '',
      appStoreUrl: '',
    );

    expect(unsupported.updateRequired, isTrue);
    expect(unsupported.updateAvailable, isTrue);
  });

  test('current build reports no update available', () {
    const current = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 9,
      googlePlayUrl: '',
      appStoreUrl: '',
    );

    expect(current.updateRequired, isFalse);
    expect(current.updateAvailable, isFalse);
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
