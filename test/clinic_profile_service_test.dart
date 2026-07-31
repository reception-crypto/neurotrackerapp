import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/services/clinic_profile_service.dart';
import 'package:neurotrackerapp/services/identity_service.dart';

void main() {
  test('Build 7 is accepted only when it is the latest configured build', () {
    const current = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 7,
      googlePlayUrl: '',
      appStoreUrl: '',
    );
    const newerAvailable = MobileConfiguration(
      minimumBuild: 7,
      latestBuild: 8,
      googlePlayUrl: '',
      appStoreUrl: '',
    );

    expect(current.updateRequired, isFalse);
    expect(newerAvailable.updateRequired, isTrue);
  });

  test('mobile requests identify the Build 7 clinic-profile protocol', () {
    final headers = IdentityService.mobileHeaders(
      json: true,
      accessToken: 'synthetic-token',
    );

    expect(headers['X-NeuroSol-Build'], '7');
    expect(headers['X-NeuroSol-Profile'], 'clinic-managed-v1');
    expect(headers['Authorization'], 'Bearer synthetic-token');
    expect(headers['Content-Type'], 'application/json');
  });
}
