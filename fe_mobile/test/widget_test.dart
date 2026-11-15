import 'package:clinicle_cms_mobile/app.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders the mobile foundation screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: ClinicleCmsApp()));

    expect(find.text('Clinicle CMS'), findsOneWidget);
    expect(find.text('Mobile foundation ready'), findsOneWidget);
  });
}
