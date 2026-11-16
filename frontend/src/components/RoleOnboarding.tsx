import React from 'react';
import { Server, Gamepad2 } from 'lucide-react';
import { UserRole } from '../lib/role';

interface RoleOnboardingProps {
  onSelect: (role: UserRole) => void;
}

export function RoleOnboarding({ onSelect }: RoleOnboardingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-md p-6 page-enter">
      <div className="bg-white/85 backdrop-blur-2xl rounded-[28px] p-10 max-w-sm w-full shadow-2xl flex flex-col items-center border border-white/60">
        <div className="text-xl font-bold tracking-tight text-neutral-900 mb-8">
          FastMinecraft
        </div>

        <div className="grid grid-cols-2 gap-4 w-full">
          <button
            onClick={() => onSelect('host')}
            className="flex flex-col items-center justify-center p-6 rounded-2xl bg-black/[0.03] hover:bg-black/[0.07] text-neutral-900 transition-all active:scale-95 group"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/90 shadow-soft flex items-center justify-center mb-3 text-neutral-800 transition-transform group-hover:scale-105">
              <Server className="w-7 h-7" />
            </div>
            <span className="font-semibold text-sm">我是服主</span>
          </button>

          <button
            onClick={() => onSelect('player')}
            className="flex flex-col items-center justify-center p-6 rounded-2xl bg-black/[0.03] hover:bg-black/[0.07] text-neutral-900 transition-all active:scale-95 group"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/90 shadow-soft flex items-center justify-center mb-3 text-neutral-800 transition-transform group-hover:scale-105">
              <Gamepad2 className="w-7 h-7" />
            </div>
            <span className="font-semibold text-sm">我是玩家</span>
          </button>
        </div>
      </div>
    </div>
  );
}
