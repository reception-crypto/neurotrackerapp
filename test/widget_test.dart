import 'package:flutter_test/flutter_test.dart';
import 'package:neurotrackerapp/main.dart';

void main() {
  testWidgets('NeuroTracker app starts', (WidgetTester tester) async {
    await tester.pumpWidget(const NeuroTrackerApp());
    await tester.pump();

    expect(find.text('NeuroTracker Clinical'), findsWidgets);
  });
}
