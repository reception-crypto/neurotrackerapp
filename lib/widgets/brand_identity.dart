import 'package:flutter/material.dart';

import '../app_identity.dart';
import '../theme/app_theme.dart';

class BrandAppBarTitle extends StatelessWidget {
  final String label;

  const BrandAppBarTitle({super.key, this.label = appShortName});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(7),
          child: Image.asset(
            'assets/icon/app_icon.png',
            width: 30,
            height: 30,
            excludeFromSemantics: true,
          ),
        ),
        const SizedBox(width: 10),
        Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
      ],
    );
  }
}

class BrandBanner extends StatelessWidget {
  final bool compact;

  const BrandBanner({super.key, this.compact = false});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: appDisplayName,
      image: true,
      excludeSemantics: true,
      child: Container(
        key: const Key('neurosol-brand-banner'),
        width: double.infinity,
        padding: EdgeInsets.fromLTRB(
          compact ? 16 : 20,
          compact ? 12 : 16,
          compact ? 16 : 20,
          compact ? 10 : 14,
        ),
        decoration: BoxDecoration(
          color: AppTheme.warmIvory,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppTheme.brandCobalt, width: 1.5),
          boxShadow: const [
            BoxShadow(
              color: Color(0x33000000),
              blurRadius: 18,
              offset: Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/branding/neurosol_wordmark.png',
              height: compact ? 60 : 72,
              fit: BoxFit.contain,
              excludeFromSemantics: true,
            ),
            SizedBox(height: compact ? 4 : 6),
            Text(
              'SYMPTOM DIARY',
              style: TextStyle(
                color: AppTheme.brandCobalt,
                fontSize: compact ? 11 : 12,
                fontWeight: FontWeight.w700,
                letterSpacing: compact ? 2.1 : 2.5,
              ),
            ),
            Container(
              width: compact ? 34 : 42,
              height: 3,
              margin: EdgeInsets.only(top: compact ? 5 : 7),
              decoration: BoxDecoration(
                color: AppTheme.accentOrange,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
