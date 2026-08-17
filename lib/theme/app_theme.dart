import 'package:flutter/material.dart';

class AppTheme {
  static const Color deepInk = Color(0xFF071421);
  static const Color background = deepInk;
  static const Color card = Color(0xFF10263A);
  static const Color elevatedSurface = Color(0xFF17354F);
  static const Color brandCobalt = Color(0xFF043779);
  static const Color primaryBlue = Color(0xFF69B5F6);
  static const Color accentOrange = Color(0xFFD45E3D);
  static const Color warningOrange = Color(0xFFF0A26B);
  static const Color successGreen = Color(0xFF72D3A7);
  static const Color warmIvory = Color(0xFFFDF8F1);
  static const Color headingBlue = warmIvory;
  static const Color bodyText = Color(0xFFF4F7FA);
  static const Color secondaryText = Color(0xFFB9C8D5);
  static const Color outline = Color(0xFF42627A);
  static const Color unselectedButton = elevatedSurface;

  static ThemeData get darkBlueTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      colorScheme: const ColorScheme.dark(
        primary: primaryBlue,
        onPrimary: deepInk,
        primaryContainer: brandCobalt,
        onPrimaryContainer: warmIvory,
        secondary: accentOrange,
        onSecondary: deepInk,
        surface: card,
        onSurface: bodyText,
        error: Color(0xFFFFB4AB),
        onError: Color(0xFF690005),
        outline: outline,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: background,
        foregroundColor: headingBlue,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          color: headingBlue,
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.1,
        ),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 16),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: outline),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        labelStyle: const TextStyle(color: secondaryText),
        hintStyle: const TextStyle(color: secondaryText),
        helperStyle: const TextStyle(color: secondaryText),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 18,
          vertical: 18,
        ),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: outline),
          borderRadius: BorderRadius.circular(14),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: primaryBlue, width: 2),
          borderRadius: BorderRadius.circular(14),
        ),
        errorBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: warningOrange),
          borderRadius: BorderRadius.circular(14),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: warningOrange, width: 2),
          borderRadius: BorderRadius.circular(14),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primaryBlue,
          foregroundColor: deepInk,
          disabledBackgroundColor: elevatedSurface,
          disabledForegroundColor: secondaryText,
          minimumSize: const Size(double.infinity, 56),
          textStyle: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: warmIvory,
          side: const BorderSide(color: outline),
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: primaryBlue),
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          color: headingBlue,
          fontSize: 30,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
        headlineMedium: TextStyle(
          color: headingBlue,
          fontSize: 26,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
        ),
        titleLarge: TextStyle(
          color: headingBlue,
          fontSize: 22,
          fontWeight: FontWeight.w700,
        ),
        bodyLarge: TextStyle(color: bodyText, fontSize: 17),
        bodyMedium: TextStyle(color: bodyText, fontSize: 15),
      ),
      iconTheme: const IconThemeData(color: primaryBlue),
      listTileTheme: const ListTileThemeData(
        iconColor: primaryBlue,
        textColor: bodyText,
        contentPadding: EdgeInsets.symmetric(horizontal: 18, vertical: 6),
      ),
      dividerTheme: const DividerThemeData(color: outline, thickness: 1),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: primaryBlue,
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: elevatedSurface,
        contentTextStyle: TextStyle(color: bodyText),
        actionTextColor: primaryBlue,
        behavior: SnackBarBehavior.floating,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      expansionTileTheme: const ExpansionTileThemeData(
        iconColor: primaryBlue,
        collapsedIconColor: secondaryText,
        textColor: warmIvory,
        collapsedTextColor: bodyText,
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return primaryBlue;
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(deepInk),
        side: const BorderSide(color: outline, width: 1.5),
      ),
    );
  }
}
