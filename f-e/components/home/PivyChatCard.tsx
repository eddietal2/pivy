'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, TrendingUp, TrendingDown, Bot } from 'lucide-react';
import TypewriterText from '@/components/ui/TypewriterText';
import { MarketOverviewSkeleton } from '@/components/ui/skeletons';
import { usePivyChat, PivyChatAsset } from '@/components/context/PivyChatContext';

interface Props {
  isLoading: boolean;
  href?: string;
  date?: string;
  time?: string;
  title?: string;
  message?: string;
}

export default function PivyChatCard({ isLoading, href = '/pivy', date = '', time = '', title = 'Morning Brief', message = '' }: Props) {
  const [titleDone, setTitleDone] = React.useState(false);
  const { todaysAssets } = usePivyChat();

  if (isLoading) return <MarketOverviewSkeleton />;

  return (
    <Link href={href}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 cursor-pointer hover:shadow-md transition-shadow duration-200">

        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              <Bot className="w-3 h-3" />
              Morning Brief
            </span>
            <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Live" />
          </div>
          <div className="text-right">
            {date && <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{date}</p>}
            {time && <p className="text-xs text-gray-400 dark:text-gray-500">{time}</p>}
          </div>
        </div>

        {/* AI-generated headline */}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-snug mb-2">
          <TypewriterText text={title} speed={12} delay={200} className="inline" onComplete={() => setTitleDone(true)} />
        </h3>

        {/* Brief preview */}
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-3">
          {titleDone && message && (
            <TypewriterText text={message} speed={8} delay={0} className="inline" />
          )}
        </p>

        {/* Assets row */}
        {todaysAssets.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-1.5">
            {todaysAssets.slice(0, 4).map((asset: PivyChatAsset) => (
              <span
                key={asset.symbol}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  asset.change >= 0
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}
              >
                {asset.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {asset.symbol.replace('-USD', '').replace('=F', '').replace('^', '')}
              </span>
            ))}
            {todaysAssets.length > 4 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                +{todaysAssets.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end mt-3 pt-2">
          <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-0.5">
            Read full brief <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

      </div>
    </Link>
  );
}

