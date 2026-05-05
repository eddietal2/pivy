'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LineChart, Newspaper, Settings } from 'lucide-react';

const navLinks = [
  { name: 'Home', href: '/home', icon: Home },
  { name: 'Watchlist', href: '/watchlist', icon: LineChart },
  { name: 'Pivy', href: '/pivy', icon: Newspaper },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { modalOpen } = require('@/components/context/UIContext').useUI();

  if (modalOpen) return null;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-gray-200/20 dark:border-gray-800/40 bg-white/80 dark:bg-black/70 backdrop-blur-md z-50">
      <div className="flex items-center justify-around px-2 pt-2" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {navLinks.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.name}
              href={link.href}
              className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'text-[#105B92] dark:text-blue-400 bg-blue-50 dark:bg-transparent'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-xs font-medium">{link.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
