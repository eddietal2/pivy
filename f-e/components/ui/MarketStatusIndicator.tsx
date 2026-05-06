'use client';

import React from 'react';
import { useMarketStatus, MarketStatus } from '@/components/context/MarketStatusContext';
import { Clock, TrendingUp, Moon, Sun, Sunrise, Sunset } from 'lucide-react';

interface MarketStatusIndicatorProps {
  variant?: 'pill' | 'banner' | 'compact';
  showNextEvent?: boolean;
  className?: string;
}

const statusConfig: Record<MarketStatus, {
  bgLight: string;
  bgDark: string;
  textLight: string;
  textDark: string;
  dotColor: string;
  Icon: React.ElementType;
}> = {
  open: {
    bgLight: 'bg-green-50 border-green-200',
    bgDark: 'dark:bg-green-900/20 dark:border-green-800',
    textLight: 'text-green-700',
    textDark: 'dark:text-green-400',
    dotColor: 'bg-green-500',
    Icon: TrendingUp,
  },
  'pre-market': {
    bgLight: 'bg-amber-50 border-amber-200',
    bgDark: 'dark:bg-amber-900/20 dark:border-amber-800',
    textLight: 'text-amber-700',
    textDark: 'dark:text-amber-400',
    dotColor: 'bg-amber-500',
    Icon: Sunrise,
  },
  'after-hours': {
    bgLight: 'bg-purple-50 border-purple-200',
    bgDark: 'dark:bg-purple-900/20 dark:border-purple-800',
    textLight: 'text-purple-700',
    textDark: 'dark:text-purple-400',
    dotColor: 'bg-purple-500',
    Icon: Sunset,
  },
  closed: {
    bgLight: 'bg-gray-100/60 border-gray-200/40',
    bgDark: 'dark:bg-gray-800/20 dark:border-gray-700/30',
    textLight: 'text-gray-600',
    textDark: 'dark:text-gray-400',
    dotColor: 'bg-gray-400 dark:bg-gray-500',
    Icon: Moon,
  },
};

export default function MarketStatusIndicator({
  variant = 'pill',
  showNextEvent = true,
  className = '',
}: MarketStatusIndicatorProps) {
  const { status, statusText, statusDescription, nextEvent, isLoading } = useMarketStatus();
  const config = statusConfig[status];
  const Icon = config.Icon;

  if (isLoading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>
    );
  }

  // Compact variant - just a dot with tooltip (for very tight spaces)
  if (variant === 'compact') {
    return (
      <div className={`group relative inline-flex items-center ${className}`} title={`${statusText}: ${nextEvent}`}>
        <span className="relative flex h-2.5 w-2.5">
          {status === 'open' && (
            <span className={`animate-ping absolute inset-0 rounded-full ${config.dotColor} opacity-75`} />
          )}
          <span className={`inline-flex rounded-full h-2.5 w-2.5 ${config.dotColor}`} />
        </span>
        {/* Tooltip on hover (desktop) */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          {statusText} · {nextEvent}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-100" />
        </div>
      </div>
    );
  }

  // Pill variant - responsive: full pill on desktop, dot + status + time on mobile
  if (variant === 'pill') {
    return (
      <div className={`inline-flex items-center ${className}`}>
        {/* Mobile: dot + status + time */}
        <div
          className={`sm:hidden inline-flex items-center gap-1.5 text-[10px] font-medium ${config.textLight} ${config.textDark}`}
        >
          <span className="relative flex h-2 w-2">
            {status === 'open' && (
              <span className={`animate-ping absolute inset-0 rounded-full ${config.dotColor} opacity-75`} />
            )}
            <span className={`inline-flex rounded-full h-2 w-2 ${config.dotColor}`} />
          </span>
          <span className="whitespace-nowrap">
            {status === 'open' ? (nextEvent || 'Open') : `${statusText}${nextEvent ? ` · ${nextEvent}` : ''}`}
          </span>
        </div>
        {/* Desktop: full pill */}
        <div
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium
            ${config.bgLight} ${config.bgDark} ${config.textLight} ${config.textDark}`}
        >
          <span className="relative flex h-2 w-2">
            {status === 'open' && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotColor} opacity-75`} />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dotColor}`} />
          </span>
          <span>{statusText}</span>
          {showNextEvent && nextEvent && (
            <span className="text-[10px] opacity-75">· {nextEvent}</span>
          )}
        </div>
      </div>
    );
  }

  // Banner variant - full-width banner
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 sm:px-5 sm:py-3
        ${config.bgLight} ${config.bgDark} ${className}`}
    >
      {/* Left: icon + status */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className={`flex-shrink-0 p-1.5 sm:p-2 rounded-full ${status === 'open' ? 'bg-green-100 dark:bg-green-800/50' : status === 'pre-market' ? 'bg-amber-100 dark:bg-amber-800/50' : status === 'after-hours' ? 'bg-purple-100 dark:bg-purple-800/50' : 'bg-gray-200 dark:bg-gray-700'}`}>
          <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${config.textLight} ${config.textDark}`} />
        </div>
        <div className="flex flex-col justify-center">
          <div className={`flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap ${config.textLight} ${config.textDark}`}>
            <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2 flex-shrink-0">
              {status === 'open' && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dotColor} opacity-75`} />
              )}
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 ${config.dotColor}`} />
            </span>
            {statusText}
          </div>
          <p className={`text-[10px] sm:text-xs mt-0.5 whitespace-nowrap ${config.textLight} ${config.textDark} opacity-60`}>
            {statusDescription}
          </p>
        </div>
      </div>

      {/* Right: next event */}
      {showNextEvent && nextEvent && (
        <div className={`flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-medium ${config.textLight} ${config.textDark} opacity-80`}>
          <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
          <span className="whitespace-nowrap">{nextEvent}</span>
        </div>
      )}
    </div>
  );
}
