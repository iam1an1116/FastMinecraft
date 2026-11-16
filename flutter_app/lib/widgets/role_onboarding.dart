import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../services/window_service.dart';
import 'ripple_button.dart';

class RoleOnboarding extends StatelessWidget {
  final Function(String) onSelectRole;

  const RoleOnboarding({super.key, required this.onSelectRole});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onPanStart: (_) => WindowService.startDragging(),
      child: Container(
        color: Colors.white.withOpacity(0.75),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'FastMinecraft',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF151515),
                  letterSpacing: -0.6,
                ),
              ),
              const SizedBox(height: 36),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildRoleOption(
                    icon: CupertinoIcons.rectangle_stack,
                    title: '我是服主',
                    onTap: () => onSelectRole('host'),
                  ),
                  const SizedBox(width: 24),
                  _buildRoleOption(
                    icon: CupertinoIcons.game_controller,
                    title: '我是玩家',
                    onTap: () => onSelectRole('player'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRoleOption({
    required IconData icon,
    required String title,
    required VoidCallback onTap,
  }) {
    return RippleButton(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 38),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 32, color: const Color(0xFF1F1F1F)),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF151515)),
          ),
        ],
      ),
    );
  }
}
