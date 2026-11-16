import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'models/server_model.dart';
import 'pages/market_page.dart';
import 'pages/network_page.dart';
import 'pages/player_mode_page.dart';
import 'pages/server_detail_page.dart';
import 'pages/servers_overview_page.dart';
import 'pages/settings_page.dart';
import 'services/api_service.dart';
import 'services/storage_service.dart';
import 'widgets/desktop_header.dart';
import 'widgets/role_onboarding.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FastMinecraftApp());
}

class FastMinecraftApp extends StatelessWidget {
  const FastMinecraftApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FastMinecraft',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.light,
        scaffoldBackgroundColor: Colors.transparent,
        canvasColor: Colors.transparent,
        fontFamily: Platform.isMacOS ? '.AppleSystemUIFont' : 'Microsoft YaHei UI',
        fontFamilyFallback: const ['Segoe UI', 'PingFang SC', 'sans-serif'],
        splashFactory: NoSplash.splashFactory,
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        useMaterial3: true,
      ),
      home: const MainAppShell(),
    );
  }
}

class MainAppShell extends StatefulWidget {
  const MainAppShell({super.key});

  @override
  State<MainAppShell> createState() => _MainAppShellState();
}

class _MainAppShellState extends State<MainAppShell> {
  String? _role;
  HostMainTab _currentMainTab = HostMainTab.servers;

  ServerInfo? _activeServer;
  ServerDetailTab _currentDetailTab = ServerDetailTab.console;
  int _backendEpoch = 0;
  Timer? _bootTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _role = StorageService.getRole();
    _ensureBackendReady(0);
  }

  @override
  void dispose() {
    _disposed = true;
    _bootTimer?.cancel();
    super.dispose();
  }

  Future<void> _ensureBackendReady(int attempt) async {
    if (_disposed || !mounted) return;
    final ok = await ApiService.pingBackend();
    if (_disposed || !mounted) return;
    if (ok) {
      if (attempt > 0) {
        setState(() => _backendEpoch++);
      }
      return;
    }
    if (attempt < 20) {
      _bootTimer = Timer(const Duration(milliseconds: 250), () {
        _ensureBackendReady(attempt + 1);
      });
    }
  }

  void _onRoleSelected(String role) {
    setState(() {
      _role = role;
      _activeServer = null;
    });
    StorageService.setRole(role);
  }

  void _onSelectServer(ServerInfo s) {
    setState(() {
      _activeServer = s;
      _currentDetailTab = ServerDetailTab.console;
    });
  }

  void _onBackToServers() {
    setState(() {
      _activeServer = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final double rAngle = Platform.isMacOS ? 32.0 : 8.0;
    final Color surfaceColor = Platform.isMacOS
        ? Colors.white.withOpacity(0.28)
        : Colors.white.withOpacity(0.42);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: ClipRRect(
        borderRadius: BorderRadius.circular(rAngle),
        child: Container(
          decoration: BoxDecoration(
            color: surfaceColor,
            borderRadius: BorderRadius.circular(rAngle),
            border: Border.all(
              color: Colors.white.withOpacity(0.55),
              width: 1.0,
            ),
          ),
          child: Stack(
            children: [
              Column(
                children: [
                  DesktopHeader(
                    currentRole: _role ?? 'host',
                    onRoleChanged: _onRoleSelected,
                    currentMainTab: _currentMainTab,
                    onMainTabChanged: (tab) => setState(() {
                      _currentMainTab = tab;
                      _activeServer = null;
                    }),
                    activeServerId: _activeServer?.id,
                    activeServerName: _activeServer?.name,
                    currentDetailTab: _currentDetailTab,
                    onDetailTabChanged: (detailTab) => setState(() => _currentDetailTab = detailTab),
                    onBackToServers: _onBackToServers,
                  ),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 120),
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      transitionBuilder: (child, animation) {
                        return FadeTransition(
                          opacity: animation,
                          child: child,
                        );
                      },
                      child: _buildCurrentPage(),
                    ),
                  ),
                ],
              ),
              if (_role == null)
                AnimatedOpacity(
                  opacity: 1.0,
                  duration: const Duration(milliseconds: 220),
                  child: RoleOnboarding(
                    onSelectRole: _onRoleSelected,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCurrentPage() {
    if (_role == 'player') {
      return KeyedSubtree(
        key: ValueKey('player_mode_$_backendEpoch'),
        child: const PlayerModePage(),
      );
    }

    if (_activeServer != null) {
      return KeyedSubtree(
        key: ValueKey('server_detail_${_activeServer!.id}_$_currentDetailTab'),
        child: ServerDetailPage(
          server: _activeServer!,
          currentTab: _currentDetailTab,
          onServerDeleted: _onBackToServers,
        ),
      );
    }

    switch (_currentMainTab) {
      case HostMainTab.servers:
        return KeyedSubtree(
          key: ValueKey('servers_overview_$_backendEpoch'),
          child: ServersOverviewPage(
            onSelectServer: _onSelectServer,
            onGoToMarket: () => setState(() => _currentMainTab = HostMainTab.market),
          ),
        );
      case HostMainTab.market:
        return KeyedSubtree(
          key: const ValueKey('market_page'),
          child: MarketPage(
            onDeployed: () => setState(() => _currentMainTab = HostMainTab.servers),
          ),
        );
      case HostMainTab.network:
        return const KeyedSubtree(
          key: ValueKey('network_page'),
          child: NetworkPage(),
        );
      case HostMainTab.settings:
        return const KeyedSubtree(
          key: ValueKey('settings_page'),
          child: SettingsPage(),
        );
    }
  }
}
