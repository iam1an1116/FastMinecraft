import 'package:flutter_test/flutter_test.dart';
import 'package:fast_minecraft/main.dart';

void main() {
  testWidgets('FastMinecraftApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const FastMinecraftApp());
    expect(find.byType(MainAppShell), findsOneWidget);
  });
}
