import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/patient_profile.dart';
import '../services/identity_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import 'home_screen.dart';
import 'profile_screen.dart';

class EnrolmentScreen extends StatefulWidget {
  final PatientProfile? existingProfile;

  const EnrolmentScreen({super.key, this.existingProfile});

  @override
  State<EnrolmentScreen> createState() => _EnrolmentScreenState();
}

class _EnrolmentScreenState extends State<EnrolmentScreen> {
  final _codeController = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _enrol() async {
    if (_submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final existing = widget.existingProfile;
      final result = await IdentityService.enrol(
        _codeController.text,
        expectedPatientId: existing?.patientId,
      );

      if (existing != null) {
        final pending = await StorageService.pendingCount();
        if (pending > 0 && existing.patientId != result.patientId) {
          await IdentityService.clearAccessToken();
          throw const EnrolmentException(
            'This code belongs to a different clinic record while unsent check-ins remain on this phone. Contact the clinic before continuing.',
          );
        }

        final updated = existing.copyWith(
          patientId: result.patientId,
          fullName: existing.fullName.trim().isEmpty
              ? result.displayName
              : existing.fullName,
        );
        await StorageService.saveProfile(updated);
        await UploadService.retryPendingUploads();
        if (!mounted) return;
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => HomeScreen(profile: updated)),
          (_) => false,
        );
        return;
      }

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => ProfileScreen(
            enrolledPatientId: result.patientId,
            initialFullName: result.displayName,
          ),
        ),
      );
    } on EnrolmentException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.patientMessage;
        _submitting = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Enrolment could not be completed. Please try again.';
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final replacing = widget.existingProfile != null;

    return Scaffold(
      appBar: AppBar(title: const Text('Clinic Enrolment')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          children: [
            Text(
              replacing ? 'Reconnect this phone' : 'Connect to your clinic',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 16),
            Text(
              replacing
                  ? 'Ask Pascoe Neurology for a new one-time enrolment code for your existing clinic record.'
                  : 'Pascoe Neurology will give you a one-time enrolment code. It securely links this diary to the correct clinic record.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (replacing) ...[
              const SizedBox(height: 14),
              Text(
                'Support ID: ${widget.existingProfile!.supportId}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ],
            const SizedBox(height: 28),
            TextField(
              key: const Key('enrolment-code-field'),
              controller: _codeController,
              enabled: !_submitting,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 -]')),
                LengthLimitingTextInputFormatter(14),
              ],
              decoration: const InputDecoration(
                labelText: 'Enrolment code',
                hintText: 'XXXX-XXXX-XXXX',
                helperText: 'Codes can only be used once.',
              ),
              onSubmitted: (_) => _enrol(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('submit-enrolment'),
              onPressed: _submitting ? null : _enrol,
              child: _submitting
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    )
                  : const Text('Enrol this phone'),
            ),
            const SizedBox(height: 18),
            const Text(
              'Do not share your enrolment code. The app is not monitored for emergencies; call 000 in an emergency.',
            ),
          ],
        ),
      ),
    );
  }
}
