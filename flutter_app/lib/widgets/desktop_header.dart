import 'dart:io';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../services/window_service.dart';
import 'ripple_button.dart';
import 'sliding_pill_bar.dart';

enum HostMainTab { servers, market, network, settings }
enum ServerDetailTab { console, players, mods, backups, config }

class DesktopHeader extends StatelessWidget {
  final String currentRole; // 'host' or 'player'
  final Function(String) onRoleChanged;
  final HostMainTab currentMainTab;
  final Function(HostMainTab) onMainTabChanged;
  final String? activeServerId;
  final String? activeServerName;
  final ServerDetailTab currentDetailTab;
  final Function(ServerDetailTab) onDetailTabChanged;
  final VoidCallback onBackToServers;

  const DesktopHeader({
    super.key,
    required this.currentRole,
    required this.onRoleChanged,
    required this.currentMainTab,
    required this.onMainTabChanged,
    this.activeServerId,
    this.activeServerName,
    required this.currentDetailTab,
    required this.onDetailTabChanged,
    required this.onBackToServers,
  });

  @override
  Widget build(BuildContext context) {
    final bool isDetailMode = activeServerId != null;

    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onPanStart: (_) => WindowService.startDragging(),
      child: Container(
        height: 54,
        padding: EdgeInsets.only(left: Platform.isMacOS ? 84 : 18, right: 16),
        color: Colors.white.withOpacity(0.08),
        child: Row(
          children: [
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 120),
                switchInCurve: Curves.easeOutCubic,
                switchOutCurve: Curves.easeInCubic,
                child: Align(
                  key: ValueKey('${currentRole}_$isDetailMode'),
                  alignment: Alignment.centerLeft,
                  child: currentRole == 'player'
                      ? const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(CupertinoIcons.game_controller, size: 16, color: Color(0xFF1F1F1F)),
                            SizedBox(width: 8),
                            Text(
                              '联机',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F)),
                            ),
                          ],
                        )
                      : isDetailMode
                          ? _buildDetailNav()
                          : _buildMainNav(),
                ),
              ),
            ),
            SlidingPillBar(
              selectedIndex: currentRole == 'player' ? 1 : 0,
              onChanged: (idx) => onRoleChanged(idx == 0 ? 'host' : 'player'),
              itemPadding: const EdgeInsets.symmetric(horizontal: 13, vertical: 6),
              borderRadius: 16,
              spacing: 2,
              items: const [
                SlidingPillItem(
                  child: Text('服主', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ),
                SlidingPillItem(
                  child: Text('玩家', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ),
              ],
            ),
            if (Platform.isWindows) ...[
              const SizedBox(width: 12),
              _buildWindowsCaptionButtons(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildWindowsCaptionButtons() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        RippleButton(
          onTap: () => WindowService.minimizeWindow(),
          borderRadius: BorderRadius.circular(10),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          child: const Icon(CupertinoIcons.minus, size: 13, color: Color(0xFF1F1F1F)),
        ),
        RippleButton(
          onTap: () => WindowService.zoomWindow(),
          borderRadius: BorderRadius.circular(10),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          child: const Icon(CupertinoIcons.square, size: 12, color: Color(0xFF1F1F1F)),
        ),
        RippleButton(
          onTap: () => WindowService.closeWindow(),
          borderRadius: BorderRadius.circular(10),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          child: const Icon(CupertinoIcons.xmark, size: 13, color: Color(0xFFE11D48)),
        ),
      ],
    );
  }

  Widget _buildMainNav() {
    return SlidingPillBar(
      selectedIndex: currentMainTab.index,
      onChanged: (idx) => onMainTabChanged(HostMainTab.values[idx]),
      itemPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      borderRadius: 18,
      spacing: 4,
      items: const [
        SlidingPillItem(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(CupertinoIcons.rectangle_grid_2x2, size: 15, color: Color(0xFF1F1F1F)),
              SizedBox(width: 6),
              Text('控制台', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
            ],
          ),
        ),
        SlidingPillItem(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(CupertinoIcons.bag, size: 15, color: Color(0xFF1F1F1F)),
              SizedBox(width: 6),
              Text('市场', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
            ],
          ),
        ),
        SlidingPillItem(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(CupertinoIcons.wifi, size: 15, color: Color(0xFF1F1F1F)),
              SizedBox(width: 6),
              Text('联机', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
            ],
          ),
        ),
        SlidingPillItem(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(CupertinoIcons.gear_alt, size: 15, color: Color(0xFF1F1F1F)),
              SizedBox(width: 6),
              Text('设置', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDetailNav() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        RippleButton(
          onTap: onBackToServers,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(CupertinoIcons.arrow_left, size: 14, color: Color(0xFF1F1F1F)),
              SizedBox(width: 6),
              Text('返回', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
            ],
          ),
        ),
        if (activeServerName != null) ...[
          const SizedBox(width: 6),
          Text(
            activeServerName!,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45)),
          ),
        ],
        const SizedBox(width: 12),
        SlidingPillBar(
          selectedIndex: currentDetailTab.index,
          onChanged: (idx) => onDetailTabChanged(ServerDetailTab.values[idx]),
          itemPadding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
          borderRadius: 16,
          spacing: 2,
          items: const [
            SlidingPillItem(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.chevron_left_slash_chevron_right, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('控制台', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
            SlidingPillItem(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.person_2, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('玩家', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
            SlidingPillItem(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.cube_box, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('Mod', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
            SlidingPillItem(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.archivebox, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('备份', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
            SlidingPillItem(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.slider_horizontal_3, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('配置', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
