import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/services/clinic_profile_service.dart';
import 'package:neurotrackerapp/services/identity_service.dart';

void main() {
  test('Build 8 accepts a gated backend that still advertises Build 7', () {
    const current = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 7,
      googlePlayUrl: '',
      appStoreUrl: '',
    );
    const newerAvailable = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 9,
      googlePlayUrl: '',
      appStoreUrl: '',
    );

    expect(current.updateRequired, isFalse);
    expect(newerAvailable.updateRequired, isTrue);
  });

  test('mobile requests advertise every Build 8 profile capability', () {
    final headers = IdentityService.mobileHeaders(
      json: true,
      accessToken: 'synthetic-token',
    );

    expect(headers['X-NeuroSol-Build'], '8');
    expect(headers['X-NeuroSol-Profile'], 'clinic-managed-v1');
    expect(headers['X-NeuroSol-Disorders'], 'canonical-v1');
    expect(headers['X-NeuroSol-Profile-Model'], 'independent-v1');
    expect(headers['Authorization'], 'Bearer synthetic-token');
    expect(headers['Content-Type'], 'application/json');
  });
}
