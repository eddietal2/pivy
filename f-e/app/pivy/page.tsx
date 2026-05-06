'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { ChevronRight, Settings, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CandleStickAnim from '../../components/ui/CandleStickAnim';
import MarketStatusIndicator from '@/components/ui/MarketStatusIndicator';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

interface ChatDay {
  date: string; // 'YYYY-MM-DD'
  message_count: number;
  preview: string;
  title: string;
  has_brief: boolean;
}

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year.slice(-2)}`;
}

function getDayOfWeek(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long' });
}

const PivyPageContent: React.FC = () => {
  const searchParams = useSearchParams();
  const todayISO = new Date().toISOString().split('T')[0];

  const [chatDays, setChatDays] = useState<ChatDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAlertVisible, setIsAlertVisible] = useState(true);
  const [isAlertClosing, setIsAlertClosing] = useState(false);
  const [alertMounted, setAlertMounted] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('pivy_welcome_dismissed') === 'true';
    setIsAlertVisible(!dismissed);
    setAlertMounted(true);
  }, []);

  useEffect(() => {
    const fetchDays = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/pivy-chat/days/`);
        const data = await res.json();
        setChatDays(data.days ?? []);
      } catch {
        setChatDays([]);
      } finally {
        setLoading(false);
      }
    };
    fetchDays();
  }, []);

  useEffect(() => {
    const drawer = searchParams.get('drawer');
    const about = searchParams.get('about');
    if (drawer === 'open') setIsDrawerOpen(true);
    if (about === 'open') setAboutExpanded(true);
  }, [searchParams]);

  useEffect(() => {
    document.body.style.overflow = isDrawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isDrawerOpen]);



  return (
    <div className="md:pt-14">
      {/* Header */}
      <header className="bg-gray-100 dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
        <div className="flex gap-2 items-center">
          <div className="w-[30px] h-[30px] relative bottom-6.5 mr-2">
            <CandleStickAnim />
          </div>
          <span className="text-base font-semibold text-gray-900 dark:text-white">Pivy Chat</span>
          <MarketStatusIndicator variant="pill" showNextEvent={false} />
        </div>
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="p-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </header>

      {/* Welcome alert */}
      {/* For Development, 
      Object.fromEntries(Object.entries(localStorage))
      localStorage.clear()
      */}
      {alertMounted && isAlertVisible && (
        <div
          className={`bg-yellow-100 dark:bg-yellow-900 border-b border-yellow-200 dark:border-yellow-700 flex justify-between items-center transform transition-all duration-300 ${isAlertClosing ? 'max-h-0 p-0 opacity-0' : 'max-h-20 p-4'}`}
          style={{ overflow: 'hidden' }}
        >
          <p className="text-yellow-800 dark:text-yellow-200 text-sm">Each weekday at 8:30 AM ET, Pivy drops a morning market brief. During market hours (9:30 AM–4 PM ET), intraday alerts fire automatically for significant moves. Tap any day to read your brief and ask follow-up questions.</p>
          <button
            onClick={() => { setIsAlertClosing(true); setTimeout(() => { setIsAlertVisible(false); localStorage.setItem('pivy_welcome_dismissed', 'true'); }, 300); }}
            className="text-yellow-800 dark:text-yellow-200 hover:text-yellow-900 dark:hover:text-yellow-100 ml-4"
          >Close</button>
        </div>
      )}

      {/* Chat day list */}
      <main className="p-4">
        <ul className="space-y-3">
          {loading ? (
            Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm animate-pulse">
                <div className="flex justify-between items-center mb-2">
                  <div className="h-3.5 bg-gray-300 dark:bg-gray-600 rounded w-16" />
                  <div className="h-3.5 bg-gray-300 dark:bg-gray-600 rounded w-12" />
                </div>
                <div className="space-y-1.5 mt-2">
                  <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                  <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
                </div>
              </li>
            ))
          ) : chatDays.length === 0 ? (
            <li className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No market briefs yet. Check back on the next trading day.
            </li>
          ) : (
            chatDays.map((chat) => (
              <li key={chat.date}>
                <Link href={`/pivy/chat/${chat.date}`} className="block">
                  <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm active:opacity-70 transition-opacity">
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">{getDayOfWeek(chat.date)}, {formatDisplayDate(chat.date)}</span>
                          {chat.date === todayISO && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 text-xs rounded-full font-medium">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
                              Today
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{chat.title || 'Market Brief'}</p>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-2 mt-0.5">
                        <span>{chat.message_count} msg{chat.message_count !== 1 ? 's' : ''}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed mt-1">
                      {chat.preview || 'No preview available.'}
                    </p>
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </main>

      {/* Settings Drawer */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[99] transition-opacity ${isDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsDrawerOpen(false)}
      >
        <div
          className={`fixed inset-0 bg-white/80 dark:bg-gray-800/20 backdrop-blur-lg shadow-lg z-[100] transform transition-transform ${isDrawerOpen ? 'translate-y-0' : 'translate-y-full'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4">

              <div className="flex justify-between items-center border-b pb-3">
                <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <h2 className="text-lg font-semibold">Pivy Chat Settings</h2>
                <button onClick={() => setIsDrawerOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Close</button>
              </div>

              {/* Notifications */}
              <button
                className="text-2xl mt-4 flex items-center justify-between w-full text-left"
                onClick={() => setNotificationsExpanded(!notificationsExpanded)}
              >
                <h3>Notifications</h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${notificationsExpanded ? 'rotate-180' : ''}`} />
              </button>
              {notificationsExpanded && (
                <div className="mt-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Each trading day's Pivy Chat will send notifications throughout the day.</p>
                  <div className="mt-4 flex bg-gray-200 dark:bg-gray-700 rounded-lg p-1">
                    <button
                      className={`flex-1 h-10 py-2 px-4 rounded-md transition-colors ${notificationsEnabled ? 'bg-amber-900 dark:bg-amber-800 text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                      onClick={() => setNotificationsEnabled(true)}
                    >On</button>
                    <button
                      className={`flex-1 h-10 py-2 px-4 rounded-md transition-colors ${!notificationsEnabled ? 'bg-amber-900 dark:bg-amber-800 text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                      onClick={() => setNotificationsEnabled(false)}
                    >Off</button>
                  </div>
                </div>
              )}

              {/* About */}
              <button
                className="text-2xl mt-4 pt-2 border-t border-gray-300 dark:border-gray-700 flex items-center justify-between w-full text-left"
                onClick={() => setAboutExpanded(!aboutExpanded)}
              >
                <h3>About Pivy Chat</h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${aboutExpanded ? 'rotate-180' : ''}`} />
              </button>
              {aboutExpanded && (
                <div className="mt-2">
                  <CandleStickAnim />
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-3">
                    Pivy Chat is your daily trading journal. A new chat is created each trading day starting from when you joined.
                    <br /><br />
                    Every morning at 8 AM EST a fresh conversation begins with real-time market analysis and personalized insights based on your watchlist. Each day builds on your trading history so you can track patterns and review past decisions.
                    <br /><br />
                    Whether you're getting a market update, discussing strategy, or reflecting on a trade â€” your daily journal is always here.
                  </p>
                </div>
              )}

            </div>

            <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="px-4 w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const PivyPage: React.FC = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <PivyPageContent />
  </Suspense>
);

export default PivyPage;
