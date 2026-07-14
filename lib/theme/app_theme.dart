import 'package:flutter/material.dart';

class AppTheme {
  static const Color background = Color(0xFF1E1E1E);
  static const Color card = Color(0xFF2A2A2A);
  static const Color primaryBlue = Color(0xFF60A5FA);
  static const Color headingBlue = Color(0xFFBFDBFE);
  static const Color bodyText = Color(0xFFF8FAFC);
  static const Color secondaryText = Color(0xFFD1D5DB);
  static const Color unselectedButton = Color(0xFF3A3A3A);

  static ThemeData get darkBlueTheme {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      colorScheme: const ColorScheme.dark(
        primary: primaryBlue,
        secondary: primaryBlue,
        surface: card,
        onSurface: bodyText,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: background,
        foregroundColor: headingBlue,
        elevation: 0,
        titleTextStyle: TextStyle(
          color: headingBlue,
          fontSize: 22,
          fontWeight: FontWeight.bold,
        ),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 2,
        margin: const EdgeInsets.only(bottom: 22),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        labelStyle: const TextStyle(color: secondaryText),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Color(0xFF4B5563)),
          borderRadius: BorderRadius.circular(12),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: primaryBlue, width: 2),
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primaryBlue,
          foregroundColor: Colors.black,
          minimumSize: const Size(double.infinity, 56),
          textStyle: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          color: headingBlue,
          fontSize: 30,
          fontWeight: FontWeight.bold,
        ),
        headlineMedium: TextStyle(
          color: headingBlue,
          fontSize: 26,
          fontWeight: FontWeight.bold,
        ),
        titleLarge: TextStyle(
          color: headingBlue,
          fontSize: 22,
          fontWeight: FontWeight.bold,
        ),
        bodyLarge: TextStyle(
          color: bodyText,
          fontSize: 17,
        ),
        bodyMedium: TextStyle(
          color: bodyText,
          fontSize: 15,
        ),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return primaryBlue;
          return unselectedButton;
        }),
        checkColor: WidgetStateProperty.all(Colors.black),
      ),
    );
  }
}
