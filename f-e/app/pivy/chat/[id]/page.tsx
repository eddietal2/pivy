'use client';
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Copy, Check, TrendingUp, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '@/components/context/ToastContext';
import { useFavorites } from '@/components/context/FavoritesContext';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

interface ChatMessage {
  id: number;
  sender: 'ai' | 'user';
  message_type: 'morning_brief' | 'intraday_alert' | 'personalized_insert' | 'user_message' | 'ai_response';
  content: string;
  created_at: string;
}

interface StockPill {
  symbol: string;
  price: string;
  change: number;
}

interface MarketSnapshot {
  watchlist: StockPill[];
  movers: {
    gainers: StockPill[];
    losers: StockPill[];
  };
}

function formatChatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: '2-digit' });
}

function formatTime(isoDatetime: string): string {
  return new Date(isoDatetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getUserEmail(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.email || null;
  } catch {
    return null;
  }
}

/** Renders markdown: bullet lists, bold, headings */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={key} className="list-disc pl-5 space-y-1 my-1">
        {listItems.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed">{inlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, i) => {
    const bulletMatch = line.match(/^[*\-]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
    } else {
      flushList(`list-${i}`);
      if (line.trim() === '') {
        // skip blank lines
      } else if (/^#{1,3}\s+/.test(line)) {
        const content = line.replace(/^#{1,3}\s+/, '');
        nodes.push(<p key={i} className="text-sm font-semibold mt-2">{inlineMarkdown(content)}</p>);
      } else {
        nodes.push(<p key={i} className="text-sm leading-relaxed">{inlineMarkdown(line)}</p>);
      }
    }
  });
  flushList('list-end');
  return <div className="space-y-1">{nodes}</div>;
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

const PivyChatInstancePage: React.FC = () => {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { favorites } = useFavorites();
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [dayTitle, setDayTitle] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const { showToast } = useToast();

  const mainRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (mainRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = mainRef.current;
      const scrolledFromBottom = scrollHeight - scrollTop - clientHeight;
      const threshold = clientHeight * 0.1; // 10% from bottom
      setShowScrollButton(scrolledFromBottom > threshold);
    }
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || sending) return;
    setInputValue('');
    setSending(true);
    setIsThinking(true);
    try {
      const email = getUserEmail();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (email) headers['X-User-Email'] = email;
      const res = await fetch(`${BACKEND_URL}/api/pivy-chat/messages/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ date: id, content: text }),
      });
      if (res.ok) {
        const data = await res.json();
        const newMsgs: ChatMessage[] = data.messages ?? [];
        if (newMsgs.length > 0) {
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const toAdd = newMsgs.filter(m => !existingIds.has(m.id));
            return [...prev, ...toAdd];
          });
        }
        // If no AI reply yet (Celery handling it), fast-poll until we get one
        if (!newMsgs.some(m => m.sender === 'ai')) {
          startFastPoll();
        } else {
          setIsThinking(false);
        }
      }
    } catch {
      // silent — polling will pick up any saved messages
      setIsThinking(false);
    } finally {
      setSending(false);
    }
  };

  const prevMessageCountRef = useRef<number | null>(null);
  const fastPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFastPoll = () => {
    if (fastPollRef.current) return; // already running
    let attempts = 0;
    fastPollRef.current = setInterval(async () => {
      attempts++;
      try {
        const email = getUserEmail();
        const headers: Record<string, string> = {};
        if (email) headers['X-User-Email'] = email;
        const res = await fetch(`${BACKEND_URL}/api/pivy-chat/messages/?date=${id}`, { headers });
        if (res.ok) {
          const data = await res.json();
          const incoming: ChatMessage[] = data.messages ?? [];
          setMessages(prev => {
            if (incoming.length > prev.length) {
              prevMessageCountRef.current = incoming.length;
              return incoming;
            }
            return prev;
          });
          const hasAiReply = incoming.some(m => m.sender === 'ai' && m.message_type === 'ai_response');
          if (hasAiReply || attempts >= 15) {
            setIsThinking(false);
            clearInterval(fastPollRef.current!);
            fastPollRef.current = null;
          }
        }
      } catch { /* silent */ }
    }, 2000);
  };

  useEffect(() => {
    setMounted(true);
    const fetchMessages = async () => {
      try {
        const email = getUserEmail();
        const headers: Record<string, string> = {};
        if (email) headers['X-User-Email'] = email;
        const res = await fetch(`${BACKEND_URL}/api/pivy-chat/messages/?date=${id}`, { headers });
        if (res.status === 404) { setNotFound(true); return; }
        if (res.ok) {
          const data = await res.json();
          const incoming: ChatMessage[] = data.messages ?? [];
          prevMessageCountRef.current = incoming.length;
          setMessages(incoming);
          if (data.title) setDayTitle(data.title);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
    const interval = setInterval(fetchMessages, 30000);
    return () => {
      clearInterval(interval);
      if (fastPollRef.current) clearInterval(fastPollRef.current);
    };
  }, [id]);

  // Fetch live market snapshot (watchlist + movers) once messages load
  useEffect(() => {
    if (loading) return;
    const hasBrief = messages.some(m => m.message_type === 'morning_brief');
    if (!hasBrief) return;

    const symbolsParam = favorites.map(f => f.symbol).join(',');
    const url = `${BACKEND_URL}/api/pivy-chat/market-snapshot/${symbolsParam ? `?symbols=${symbolsParam}` : ''}`;
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMarketSnapshot(data); })
      .catch(() => { /* silent */ });
  }, [loading, messages, favorites]);

  useEffect(() => {
    const element = mainRef.current;
    if (element) {
      element.addEventListener('scroll', handleScroll);
      return () => element.removeEventListener('scroll', handleScroll);
    }
  }, []);

  useLayoutEffect(() => {
    if (!loading && messages.length > 0) {
      mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [loading, messages]);

  useLayoutEffect(() => {
    if (isThinking) {
      mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [isThinking]);


  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">No chat for this date</h1>
          <Link href="/pivy" className="text-blue-500 hover:text-blue-700">
            Back to Pivy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 md:top-14 flex flex-col bg-gray-50 dark:bg-gray-900 transform transition-all duration-300 ${mounted && !isExiting ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
      {/* Header */}
      <header className="bg-gray-100 dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 flex items-center">
        <button 
          onClick={() => {
            setIsExiting(true);
            setTimeout(() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back();
              } else {
                router.push('/pivy');
              }
            }, 500);
          }}
          className="mr-4 p-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {loading ? (
          <div className="flex-1 animate-pulse">
            <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-1"></div>
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4"></div>
          </div>
        ) : (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                {dayTitle || 'Pivy Chat'}
              </h1>
              {id === new Date().toISOString().split('T')[0] && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 text-xs rounded-full font-medium">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
                  Today
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{formatChatDate(id)}</p>
          </div>
        )}
        <button
          onClick={() => {
            setIsExiting(true);
            setTimeout(() => router.push('/pivy'), 500);
          }}
          className="hidden md:block ml-4 px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          Close
        </button>
      </header>

      {/* Chat Messages */}
      <main ref={mainRef} className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        <div className="max-w-2xl mx-auto px-4 py-4">
        {loading ? (
          <div className="space-y-4">
            {/* AI bubble skeleton */}
            {[0.6, 0.8, 0.5, 0.75, 0.65].map((w, index) => (
              <div key={index} className="flex justify-start">
                <div className="w-full animate-pulse">
                  <div className="h-20 px-4 py-3 rounded-xl bg-gray-200 dark:bg-gray-700">
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded mb-2" style={{ width: `${w * 100}%` }}></div>
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded mb-2 w-full"></div>
                    <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded" style={{ width: `${(w * 0.7) * 100}%` }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, index) => (
              <div key={msg.id ?? index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="flex flex-col gap-1 max-w-[85%]">
                  {msg.sender === 'ai' && msg.message_type === 'intraday_alert' && (
                    <span className="self-start px-2 py-0.5 text-xs font-medium bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 rounded-full">Alert</span>
                  )}
                  {msg.sender === 'ai' && msg.message_type === 'morning_brief' && (
                    <span className="self-start px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full">Morning Brief</span>
                  )}
                  <div className={`px-4 py-2 rounded-lg ${
                    msg.sender === 'user'
                      ? 'bg-blue-500 text-white'
                      : msg.message_type === 'intraday_alert'
                        ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 text-gray-900 dark:text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow'
                  }`}>
                    <div className="text-sm">{msg.sender === 'ai' ? renderMarkdown(msg.content) : <span className="whitespace-pre-wrap">{msg.content}</span>}</div>
                    <p className={`text-xs mt-1 ${msg.sender === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                      {formatTime(msg.created_at)}
                    </p>

                    {/* AI message toolbar */}
                    {msg.sender !== 'user' && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              if (navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(msg.content);
                              } else {
                                const el = document.createElement('textarea');
                                el.value = msg.content;
                                document.body.appendChild(el);
                                el.select();
                                document.execCommand('copy');
                                document.body.removeChild(el);
                              }
                              setCopiedIndex(index);
                              showToast('Message copied to clipboard', 'success', 2000);
                              setTimeout(() => setCopiedIndex(null), 2000);
                            } catch {
                              showToast('Could not copy message', 'error', 3000);
                            }
                          }}
                          title="Copy message"
                          aria-label={`Copy message ${index}`}
                          className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {copiedIndex === index ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                          <span>{copiedIndex === index ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    )}

                    {/* Market snapshot pills — inside morning brief bubble */}
                    {msg.sender === 'ai' && msg.message_type === 'morning_brief' && marketSnapshot && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">
                        {/* Watchlist */}
                        {marketSnapshot.watchlist.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-semibold uppercase tracking-wide">Your Watchlist · Yesterday</p>
                            <div className="flex flex-wrap gap-1.5">
                              {marketSnapshot.watchlist.map(s => (
                                <Link
                                  key={s.symbol}
                                  href={`/stock/${s.symbol}`}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                                    s.change >= 0
                                      ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50'
                                      : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50'
                                  }`}
                                >
                                  <span>{s.symbol}</span>
                                  <span className="opacity-75">{s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Top Movers */}
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-semibold uppercase tracking-wide">Yesterday's Top Movers</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium flex items-center gap-1">
                                <TrendingUp className="w-3 h-3 text-green-500" /> Gainers
                              </p>
                              <div className="flex flex-col gap-1">
                                {marketSnapshot.movers.gainers.map(s => (
                                  <Link
                                    key={s.symbol}
                                    href={`/stock/${s.symbol}`}
                                    className="inline-flex items-center justify-between px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
                                  >
                                    <span>{s.symbol}</span>
                                    <span>+{s.change.toFixed(2)}%</span>
                                  </Link>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium flex items-center gap-1">
                                <TrendingDown className="w-3 h-3 text-red-500" /> Losers
                              </p>
                              <div className="flex flex-col gap-1">
                                {marketSnapshot.movers.losers.map(s => (
                                  <Link
                                    key={s.symbol}
                                    href={`/stock/${s.symbol}`}
                                    className="inline-flex items-center justify-between px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                                  >
                                    <span>{s.symbol}</span>
                                    <span>{s.change.toFixed(2)}%</span>
                                  </Link>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {/* Thinking indicator */}
            {isThinking && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-lg bg-white dark:bg-gray-800 shadow">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            {/* Bottom Close button — mobile only */}
            <div className="flex justify-center mt-12 border-t border-gray-300 dark:border-gray-700 pt-4 md:hidden">
              <button
                onClick={() => {
                  setIsExiting(true);
                  setTimeout(() => router.push('/pivy'), 500);
                }}
                className="w-full px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
        </div>
      </main>

      {/* Input Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </footer>

      {/* Scroll to Bottom Button */}
      {showScrollButton && (
        <button
          onClick={() => mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: 'smooth' })}
          className="fixed bottom-24 right-4 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 transition-colors z-10"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export default PivyChatInstancePage;