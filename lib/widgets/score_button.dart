import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class ScoreButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onPressed;
  final double width;

  const ScoreButton({
    super.key,
    required this.label,
    required this.selected,
    required this.onPressed,
    this.width = 54,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: 52,
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          backgroundColor: selected ? AppTheme.primaryBlue : AppTheme.unselectedButton,
          foregroundColor: selected ? Colors.black : AppTheme.bodyText,
          side: BorderSide(
            color: selected ? AppTheme.headingBlue : const Color(0xFF4B5563),
            width: selected ? 2 : 1,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: EdgeInsets.zero,
        ),
        onPressed: onPressed,
        child: Text(
          label,
          style: TextStyle(
            fontSize: selected ? 22 : 19,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }
}
