import 'package:flutter/material.dart';

import '../../../l10n/app_localizations.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(title: Text(localizations.appTitle)),
      body: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.health_and_safety_outlined, size: 64),
            SizedBox(height: 16),
            Text('Mobile foundation ready'),
          ],
        ),
      ),
    );
  }
}
