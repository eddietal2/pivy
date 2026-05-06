'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Home, LineChart, Newspaper, Settings, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/context/ThemeContext';

const navLinks = [
  { name: 'Home', href: '/home', icon: Home },
  { name: 'Watchlist', href: '/watchlist', icon: LineChart },
  { name: 'Pivy', href: '/pivy', icon: Newspaper },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function TopNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  // Determine logo based on theme (same as login page)
  const logoSrc = theme === 'dark' 
    ? '/login/logo-v1-white.png'
    : '/login/logo-v1.png';

  return (
    <nav className="hidden md:flex fixed top-0 left-0 right-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link href="/home" className="relative" style={{ width: '120px', height: '24px' }}>
          <Image 
            src={logoSrc} 
            alt="Pivotal Logo"
            fill={true} 
            className="object-contain"
            priority
          />
        </Link>

        {/* Navigation Links */}
        <div className="flex items-center gap-1">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            
            return (
              <Link key={link.name} href={link.href}>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="sm"
                  className={`gap-2 font-raleway ${!isActive ? 'bg-transparent text-[#98a0a8] hover:bg-[#164e64] hover:text-white' : 'bg-gradient-to-br from-[#0e74a7] to-[#1fa0c8] text-white shadow-sm'}`}
                >
                  <Icon className="h-4 w-4" />
                  {link.name}
                </Button>
              </Link>
            );
          })}
        </div>

        {/* Theme Toggle & User Menu */}
        <div className="flex items-center gap-2">
          {/* Theme Toggle Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </nav>
  );
}
