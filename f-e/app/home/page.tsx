'use client';
  
import React from 'react';
import InfoModal from '@/components/modals/InfoModal';
import { lockScroll, unlockScroll } from '@/components/modals/scrollLock';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import { useToast } from '@/components/context/ToastContext';
import { usePaperTrading } from '@/components/context/PaperTradingContext';
import { useFavorites } from '@/components/context/FavoritesContext';
import SignalFeedItem from '@/components/ui/SignalFeedItem';
import { useUI } from '@/components/context/UIContext';
import { ListChecks, ArrowUpRight, ArrowDownRight, TrendingUp, Info, X, Cpu, List, Grid, AlertTriangle, FileText, ChevronRight, Star, Activity } from 'lucide-react';
import SignalEducationCard from '@/components/ui/SignalEducationCard';
import signalEducationCards from '@/components/ui/signalEducationData';
import WatchListItem from '@/components/watchlist/WatchListItem';
import LiveScreen from '@/components/watchlist/LiveScreen';
import { MarketPulseSkeleton, MarketOverviewSkeleton, SignalFeedSkeleton, DisclaimersSkeleton, TopIndicatorsSkeleton } from '@/components/ui/skeletons';
import Link from 'next/link';
import CandleStickAnim from '@/components/ui/CandleStickAnim';
import PivyChatCard from '@/components/home/PivyChatCard';
import DisclaimersSection from '@/components/home/DisclaimersSection';
import PostLoginToastHandler from '@/components/ui/PostLoginToastHandler';
import StockPreviewModal from '@/components/stock/StockPreviewModal';
import MarketStatusIndicator from '@/components/ui/MarketStatusIndicator';

// Ticker to name mapping for Market Pulse (same as watchlist)
const tickerNames: Record<string, string> = {
  '^GSPC': 'SP 500',
  '^DJI': 'DOW',
  '^IXIC': 'Nasdaq',
  '^VIX': 'VIX (Fear Index)',
  'BTC-USD': 'Bitcoin',
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'CL=F': 'Crude Oil',
  '^RUT': 'Russell 2000',
  'ETH-USD': 'Ethereum',
  'HG=F': 'Copper',
  'NG=F': 'Natural Gas'
};

// CollapsibleSection is now an extracted component in components/CollapsibleSection.tsx

// --- MOCK DATA ---

// Mapping of display names to API tickers
const tickerMapping: Record<string, string> = {
  'S&P 500': '^GSPC',
  'DOW': '^DJI',
  'Nasdaq': '^IXIC',
  'VIX (Fear Index)': '^VIX',
  '10-Yr Yield': '^TNX',
  'Bitcoin': 'BTC-USD',
  'Gold': 'GC=F',
  'Silver': 'SI=F',
  'Crude Oil': 'CL=F',
  'Russell 2000': '^RUT',
  '2-Yr Yield': '^IRX',
  'Ethereum': 'ETH-USD',
  'Copper': 'HG=F',
  'Natural Gas': 'NG=F',
  'CALL/PUT Ratio': 'CPC=F', // Placeholder
  'AAII Retailer Investor Sentiment': 'AAII', // Placeholder
};



// --- Using shared WatchListItem from components/watchlist



// 4. Main Application Layout
export default function App() {
  const { modalOpen, setModalOpen } = useUI();
  const { isEnabled: isPaperTradingEnabled, account: paperTradingAccount, positions: paperTradingPositions, isLoading: isPaperTradingLoading } = usePaperTrading();
  const { favorites } = useFavorites();
  const [signalFeedInfoOpen, setSignalFeedInfoOpen] = React.useState(false);
  // Combined info modal (replaces Market Pulse and Market Overview modals)
  const [infoModalOpen, setInfoModalOpen] = React.useState(false);
  const [disclaimerModalOpen, setDisclaimerModalOpen] = React.useState(false);
  const [stopLossModalOpen, setStopLossModalOpen] = React.useState(false);
  const [aiUsageModalOpen, setAiUsageModalOpen] = React.useState(false);
  const [overviewCpuState, setOverviewCpuState] = React.useState({ loading: false, isTyping: false });
  // Timeframe filter for Market Pulse (D, W, M, Y)
  const [pulseTimeframe, setPulseTimeframe] = React.useState<'D'|'W'|'M'|'Y'>('D');
  // view mode for Market Pulse cards: 'slider' (horizontal) on mobile vs 'list' (vertical)
  const [pulseViewMode, setPulseViewMode] = React.useState<'slider'|'list'>(() => {
    try {
      if (typeof window === 'undefined') return 'slider';
      const saved = window.localStorage.getItem('pulse_view_mode');
      return saved === 'list' ? 'list' : 'slider';
    } catch (err) {
      return 'slider';
    }
  });
  // Animation state for toggling view modes
  const [pulseViewAnimating, setPulseViewAnimating] = React.useState(false);
  // Real market data state
  const [realMarketData, setRealMarketData] = React.useState<Record<string, any>>({});
  const [marketDataLoading, setMarketDataLoading] = React.useState(false);

  const handleSetPulseViewMode = (view: 'slider'|'list') => {
    if (view === pulseViewMode) return;
    // Start a short fade/scale animation, switch mode mid-way
    setPulseViewAnimating(true);
    setTimeout(() => {
      setPulseViewMode(view);
      try { if (typeof window !== 'undefined') window.localStorage.setItem('pulse_view_mode', view); } catch (err) { /* ignore */ }
      // small delay for a smooth return to full opacity/scale
      setTimeout(() => setPulseViewAnimating(false), 160);
    }, 160);
  };

  // Persist view mode choice
  React.useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem('pulse_view_mode', pulseViewMode);
    } catch (err) { /* ignore */ }
  }, [pulseViewMode]);
  // Default expansion for Market Pulse is always true; removed UI toggle
  // Instead of inline alerts, disclaimers live in a collapsible section at the bottom
  // Loading state for skeletons
  const [isLoading, setIsLoading] = React.useState(true);
  const { showToast } = useToast();

  // Market data state for top indicators
  const [marketData, setMarketData] = React.useState<Record<string, any>>({});
  const [topBullish, setTopBullish] = React.useState<any>(null);
  const [topBearish, setTopBearish] = React.useState<any>(null);
  const [topIndicatorsLoading, setTopIndicatorsLoading] = React.useState(true);
  const [topIndicatorsError, setTopIndicatorsError] = React.useState<string | null>(null);
  const [retryCount, setRetryCount] = React.useState(0);
  const retryCountRef = React.useRef(0);
  const retryTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = React.useRef(true);

  // Pivy Chat latest message state
  const [pivyLatest, setPivyLatest] = React.useState<{ date: string; time: string; title: string; message: string; href: string; isoDate: string; messageType: string } | null>(null);

  React.useEffect(() => {
    const fetchLatest = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/pivy-chat/messages/latest/`);
        if (!res.ok) return;
        const data = await res.json();
        const msg = data.message;
        if (!msg) return;
        const msgDate = new Date(msg.created_at);
        const dateStr = msgDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
        const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isoDate = msg.created_at.slice(0, 10);
        const dayOfWeek = new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
        // Strip leading markdown heading from morning brief content for preview
        const preview = msg.content.replace(/^#+\s.*\n?/, '').replace(/\*\*/g, '').trim().slice(0, 120);
        setPivyLatest({ date: dayOfWeek + ', ' + dateStr, time: timeStr, title: data.day_title || 'Morning Brief', message: preview, href: `/pivy/chat/${isoDate}`, isoDate, messageType: msg.message_type });
      } catch {
        // silent
      }
    };
    fetchLatest();
  }, []);

  // StockPreviewModal state
  const [previewModalOpen, setPreviewModalOpen] = React.useState(false);
  const [previewStock, setPreviewStock] = React.useState<{
    symbol: string;
    name: string;
    price: number;
    change: number;
    valueChange: number;
    sparkline: number[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // Open preview modal with stock data
  const openPreviewModal = React.useCallback(async (symbol: string, name: string) => {
    // Open modal immediately with placeholder data to show skeleton
    setPreviewStock({
      symbol,
      name,
      price: 0,
      change: 0,
      valueChange: 0,
      sparkline: [],
    });
    setPreviewModalOpen(true);
    setPreviewLoading(true);
    
    // Fetch actual data in background
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/market-data/stock-detail/?symbol=${encodeURIComponent(symbol)}&timeframe=day`
      );
      if (response.ok) {
        const data = await response.json();
        // Small delay to ensure skeleton is visible
        await new Promise(resolve => setTimeout(resolve, 300));
        setPreviewStock({
          symbol,
          name: data.name || name,
          price: data.price || 0,
          change: data.change || 0,
          valueChange: data.valueChange || 0,
          sparkline: data.sparkline || [],
        });
      }
    } catch (error) {
      console.error('Error fetching preview data:', error);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Fetch market data for top indicators
  const fetchMarketData = React.useCallback(async (isRetry = false) => {
    // Skip in test environment
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    
    // Clear any pending retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    if (!isRetry) {
      setTopIndicatorsLoading(true);
      setTopIndicatorsError(null);
      retryCountRef.current = 0;
      setRetryCount(0);
    }
    
    try {
      const tickers = Object.keys(tickerNames).join(',');
      console.log('Fetching market data for tickers:', tickers);
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/market-data/?tickers=${tickers}`, {
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Received market data:', data);
      setMarketData(data);
      setTopIndicatorsError(null);
      retryCountRef.current = 0;
      setRetryCount(0);

      // Calculate top bullish and bearish indicators
      const entries = Object.entries(data);
      console.log('Data entries:', entries);
      if (entries.length > 0) {
        let maxChange = -Infinity;
        let minChange = Infinity;
        let bullishItem = null;
        let bearishItem = null;

        entries.forEach(([ticker, tickerData]: [string, any]) => {
          console.log(`Processing ${ticker}:`, tickerData);
          // Use today's change from the day timeframe
          const dayTimeframe = tickerData?.timeframes?.day;
          const change = dayTimeframe?.latest?.change ?? tickerData?.change ?? tickerData?.price?.change ?? 0;
          console.log(`Change for ${ticker}:`, change);
          
          if (change > maxChange) {
            maxChange = change;
            bullishItem = {
              ticker: tickerNames[ticker] || ticker,
              symbol: ticker,
              change: change,
              price: dayTimeframe?.latest?.close ?? tickerData?.price ?? tickerData?.latest?.close ?? 'N/A'
            };
          }
          
          if (change < minChange) {
            minChange = change;
            bearishItem = {
              ticker: tickerNames[ticker] || ticker,
              symbol: ticker,
              change: change,
              price: dayTimeframe?.latest?.close ?? tickerData?.price ?? tickerData?.latest?.close ?? 'N/A'
            };
          }
        });

        console.log('Top bullish:', bullishItem);
        console.log('Top bearish:', bearishItem);
        setTopBullish(bullishItem);
        setTopBearish(bearishItem);
      } else {
        // No data received - set error
        console.log('No market data received');
        throw new Error('No market data received from server');
      }
    } catch (error: any) {
      console.error('Error fetching market data:', error);
      
      let errorMessage = 'Unable to load market data';
      if (error.message?.includes('Failed to fetch') || error.name === 'TypeError') {
        errorMessage = 'Unable to connect to the market data server. Please ensure the backend server is running.';
      } else if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        errorMessage = 'Request timed out. The server is processing market data. Please wait...';
      } else if (error.message?.includes('HTTP error')) {
        errorMessage = `Server error: ${error.message}`;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setTopIndicatorsError(errorMessage);
      setTopBullish(null);
      setTopBearish(null);
      
      // Auto-retry up to 10 times with backoff
      if (retryCountRef.current < 10 && isMountedRef.current) {
        const delay = Math.min(2000 + (retryCountRef.current * 2000), 15000);
        retryCountRef.current++;
        setRetryCount(retryCountRef.current);
        console.log(`Will retry in ${delay / 1000}s (attempt ${retryCountRef.current}/10)`);
        retryTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            fetchMarketData(true);
          }
        }, delay);
      }
    } finally {
      setTopIndicatorsLoading(false);
    }
  }, []);

  // Fetch market data on mount (skip in test environment)
  React.useEffect(() => {
    isMountedRef.current = true;
    
    if (process.env.NODE_ENV !== 'test') {
      fetchMarketData();
    } else {
      // In test environment, set loading to false immediately
      setTopIndicatorsLoading(false);
    }
    
    return () => {
      isMountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [fetchMarketData]);

  // Track open state of sections


  // Simulate loading on mount
  React.useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2000); // 2 second loading simulation
    return () => clearTimeout(timer);
  }, []);

  // Post-login toast handler has been moved to RootLayout's PostLoginToastHandler.

  // prevent background scrolling when the pulse info modal is open
  React.useEffect(() => {
    let locked = false;
    if (modalOpen) {
      lockScroll();
      locked = true;
    }
    return () => {
      if (locked) {
        unlockScroll();
      }
    };
  }, [modalOpen]);

  // Normalize timeframe string to a category: D, W, M, Y (kept for signal/timeframe helpers)
  const normalizeTimeframe = (tf?: string) => {
    if (!tf) return 'D';
    const t = tf.toUpperCase();
    if (t.includes('24H') || t.endsWith('D') || t.includes('DAY') || t === '1D') return 'D';
    if (t.includes('W') || t.includes('WEEK')) return 'W';
    if (t.includes('M') && !t.includes('MS')) return 'M';
    if (t.includes('Y') || t.includes('YEAR')) return 'Y';
    return 'D';
  };
  // Human-friendly label for timeframe used in the modal pill (capitalized like MarketOverview)
  const humanTimeframeLabel = (tf?: string) => {
    if (!tf) return '';
    const t = tf.toUpperCase();
    if (t === '24H') return '24H';
    if (t === '1D') return 'In the Last Day';
    if (t === '1W') return 'In the Last Week';
    if (t === '1M') return 'In the Last Month';
    if (t === '1Y') return 'In the Last Year';
    return tf;
  };
  
  // Fetch real market data
  const fetchRealMarketData = React.useCallback(async () => {
    // Skip in test environment
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    
    setMarketDataLoading(true);
    try {
      const data: Record<string, any> = {};
      
      // Fetch data for each unique ticker
      const uniqueTickers = [...new Set(Object.values(tickerMapping))];
      
      for (const ticker of uniqueTickers) {
        try {
          // Fetch market data (includes both price and RV)
          const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/market-data/?tickers=${ticker}`);
          const marketData = await response.json();
          
          data[ticker] = marketData[ticker];
        } catch (error) {
          console.error(`Error fetching data for ${ticker}:`, error);
        }
      }
      
      setRealMarketData(data);
    } catch (error) {
      console.error('Error fetching market data:', error);
    } finally {
      setMarketDataLoading(false);
    }
  }, []);

  // Fetch data on mount
  React.useEffect(() => {
    fetchRealMarketData();
  }, [fetchRealMarketData]);


  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900/20 dark:text-white font-sans">

      {/* Custom scrollbar styles */}
      <style>
        {`
          .scrollbar-hide {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;  /* Firefox */
          }
          .scrollbar-hide::-webkit-scrollbar {
            display: none;  /* Chrome, Safari and Opera */
          }
        `}
      </style>

      {/* Fixed Market Status Banner */}
      <div className="fixed top-0 md:top-14 left-0 right-0 z-40 lg:px-64 backdrop-blur-md bg-white/80 dark:bg-gray-900/80 border-b border-gray-200/50 dark:border-gray-700/50">
        <MarketStatusIndicator variant="banner" className="" />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto lg:px-64">
        <div className="space-y-8 px-4 sm:p-8 md:mt-10 pt-14">

          {/* Current Day Pivy Chat */}
          <div className="my-4">
            <CandleStickAnim />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Today's Pivy Chat</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Catch up on today's conversation with your AI assistant.</p>
          </div>

          <PivyChatCard
            isLoading={isLoading}
            href={pivyLatest?.href ?? '/pivy'}
            date={pivyLatest?.date ?? ''}
            time={pivyLatest?.time ?? ''}
            title={pivyLatest?.title ?? ''}
            message={pivyLatest?.message ?? 'No brief yet today.'}
          />
          <div className="mt-6 text-right">
            <Link href="/pivy?drawer=open&about=open" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 text-sm font-medium">
              Learn more about Pivy Chat →
            </Link>
          </div>

          {/* Top Market Indicator at the Moment */}
          {topIndicatorsLoading ? <TopIndicatorsSkeleton /> : topIndicatorsError ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl mt-4 p-6 shadow-sm dark:shadow-lg border border-red-200 dark:border-red-800/30">
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div className="w-12 h-12 text-red-400 mb-4 flex items-center justify-center">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Unable to Load Market Data</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">{topIndicatorsError}</p>
                {retryCount > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Retrying... (attempt {retryCount}/10)
                  </p>
                )}
                <button
                  onClick={() => {
                    retryCountRef.current = 0;
                    setRetryCount(0);
                    fetchMarketData();
                  }}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  disabled={topIndicatorsLoading}
                >
                  {topIndicatorsLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      Retrying...
                    </>
                  ) : 'Try Again'}
                </button>
              </div>
            </div>
          ) : (topBullish || topBearish) && (
            <CollapsibleSection
              title={
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-500" />
                  <span className="text-xl font-bold text-gray-900 dark:text-white">Market Movers</span>
                </div>
              }
              defaultOpen={true}
              borderBottom={false}
            >
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm dark:shadow-lg border border-gray-200 dark:border-gray-700">
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">An AI generated impression of these two together</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {topBullish && (
                  <button
                    onClick={() => openPreviewModal(topBullish.symbol, topBullish.ticker)}
                    className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors text-left w-full"
                  >
                    <div className="flex items-center justify-center w-10 h-10 bg-green-100 dark:bg-green-800 rounded-full">
                      <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900 dark:text-white">{topBullish.ticker}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{topBullish.symbol}</div>
                      <div className="text-lg font-bold text-green-600 dark:text-green-400">
                        +{topBullish.change?.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                )}
                {topBearish && (
                  <button
                    onClick={() => openPreviewModal(topBearish.symbol, topBearish.ticker)}
                    className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-left w-full"
                  >
                    <div className="flex items-center justify-center w-10 h-10 bg-red-100 dark:bg-red-800 rounded-full">
                      <TrendingUp className="w-5 h-5 text-red-600 dark:text-red-400 rotate-180" />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900 dark:text-white">{topBearish.ticker}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{topBearish.symbol}</div>
                      <div className="text-lg font-bold text-red-600 dark:text-red-400">
                        {topBearish.change?.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                )}
              </div>
              <div className="mt-4 text-center">
                  <Link href="/watchlist" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 text-sm font-medium">
                    View all market indicators →
                  </Link>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Paper Trading Holdings - Only shown when enabled */}
          {isPaperTradingEnabled && (
            <CollapsibleSection
              title={
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-orange-500" />
                  <span className="text-xl font-bold text-gray-900 dark:text-white">Paper Trading</span>
                  {paperTradingAccount && (
                    <span className="ml-auto text-sm font-semibold text-gray-900 dark:text-white">
                      ${parseFloat(paperTradingAccount.total_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              }
              defaultOpen={true}
              borderBottom={false}
            >
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm dark:shadow-lg border border-orange-200 dark:border-orange-800/30">

              {isPaperTradingLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
                </div>
              ) : paperTradingAccount ? (
                <>
                  {/* Account Summary Row */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Cash</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        ${parseFloat(paperTradingAccount.balance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">P&L</p>
                      <p className={`text-sm font-semibold ${parseFloat(paperTradingAccount.total_pl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {parseFloat(paperTradingAccount.total_pl) >= 0 ? '+' : ''}${parseFloat(paperTradingAccount.total_pl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Return</p>
                      <p className={`text-sm font-semibold ${parseFloat(paperTradingAccount.total_pl_percent) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {parseFloat(paperTradingAccount.total_pl_percent) >= 0 ? '+' : ''}{parseFloat(paperTradingAccount.total_pl_percent).toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  {/* Holdings List */}
                  {paperTradingPositions.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Holdings ({paperTradingPositions.length})</p>
                      {paperTradingPositions.slice(0, 5).map((position) => (
                        <button
                          key={position.symbol}
                          onClick={() => openPreviewModal(position.symbol, position.name)}
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600/50 transition-colors w-full text-left"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900 dark:text-white">{position.symbol}</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400">{position.quantity} shares</span>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{position.name}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-gray-900 dark:text-white">
                              ${parseFloat(position.market_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                            <p className={`text-xs font-medium ${parseFloat(position.unrealized_pl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {parseFloat(position.unrealized_pl) >= 0 ? '+' : ''}{parseFloat(position.unrealized_pl_percent).toFixed(2)}%
                            </p>
                          </div>
                        </button>
                      ))}
                      {paperTradingPositions.length > 5 && (
                        <p className="text-xs text-center text-gray-500 dark:text-gray-400 pt-2">
                          +{paperTradingPositions.length - 5} more positions
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                      <p className="text-sm">No positions yet</p>
                      <p className="text-xs mt-1">Start trading from stock detail pages</p>
                    </div>
                  )}

                  {/* Link to Paper Trading */}
                  <div className="mt-4 text-center">
                    <Link href="/paper-trading" className="text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300 text-sm font-medium">
                      View full portfolio →
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                  <p>Unable to load account</p>
                </div>
              )}
              </div>
            </CollapsibleSection>
          )}

          {/* My Screens - User's Favorites with Live Technical Analysis */}
          {favorites.length > 0 && (
            <CollapsibleSection
              title={
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-purple-500 fill-purple-500" />
                  <span className="text-xl font-bold text-gray-900 dark:text-white">My Screens</span>
                  <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({favorites.length})</span>
                </div>
              }
              defaultOpen={true}
              borderBottom={false}
            >
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm dark:shadow-lg border border-purple-200 dark:border-purple-800/30">
                <LiveScreen
                  favorites={favorites}
                  enableSwipe={false}
                  isActive={true}
                />
                <div className="mt-4 text-center">
                  <Link href="/watchlist?tab=2" className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 text-sm font-medium">
                    Manage My Screens →
                  </Link>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Market Pulse Info Modal (refactored to InfoModal) */}
          {/* Unified Info Modal: includes both Market Pulse details and Market Overview details */}
          <InfoModal
            open={infoModalOpen}
            onClose={() => setInfoModalOpen(false)}
            title={<><Info className="w-5 h-5 text-gray-900 dark:text-orange-300" />Market Info</>}
            ariaLabel="Market Info"
          >
            <div className="w-full max-w-2xl mx-auto space-y-6">
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h4 className="text-xl font-bold text-gray-900 dark:text-orange-300 flex items-center gap-2 mb-3">
                  <Cpu
                    data-testid="modal-cpu-indicator"
                    data-state={overviewCpuState.loading ? 'loading' : overviewCpuState.isTyping ? 'typing' : 'idle'}
                    className={`${overviewCpuState.loading ? 'text-gray-400 animate-pulse' : overviewCpuState.isTyping ? 'text-green-300 animate-pulse' : 'text-gray-900 dark:text-orange-300'} w-5 h-5`}
                    aria-hidden
                  />
                  Market Overview Details
                </h4>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">Market Overview is generated by an AI engine to summarize the current Market Pulse items. It interprets recent data and highlights potential areas of interest to investigate further using the detailed charts.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Note: AI output shown is illustrative; use with judgment and confirm with chart analysis. This feature currently uses a simple local heuristic as a placeholder for a real AI endpoint.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h4 className="text-xl font-bold text-gray-900 dark:text-green-300 flex items-center gap-2 mb-3">
                  <TrendingUp className="w-5 h-5" />
                  About Market Pulse
                </h4>
                <p className="text-sm text-gray-700 dark:text-gray-300">Market Pulse provides a quick overview of key market indicators to help you gauge the current financial environment.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-green-300 mb-2">S&P 500</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">The S&P 500 is a stock market index tracking the performance of 500 large companies listed on stock exchanges in the United States. It is widely regarded as the best single gauge of large-cap U.S. equities.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-green-300 mb-2">VIX (Fear Index)</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">The VIX, or Volatility Index, measures the market's expectation of volatility over the next 30 days. It is often referred to as the "fear index" and spikes during market turmoil.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-green-300 mb-2">10-Year Treasury Yield</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">The 10-Year Treasury Yield reflects the return on investment for U.S. government bonds maturing in 10 years. It is a key indicator for interest rates and economic outlook.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-green-300 mb-2">Bitcoin</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">Bitcoin (BTC) is the world's largest cryptocurrency by market capitalization. It is a decentralized digital currency that operates without a central bank and is traded globally 24/7. Bitcoin is often seen as a store of value and a hedge against inflation.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-green-300 mb-2">How to Use</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">Monitor these indices to understand the current market environment. Rising S&P 500 values indicate bullish sentiment, while spikes in the VIX suggest increased fear or volatility. The 10-Year Yield reflects interest rate expectations and economic outlook.</p>
              </div>
            </div>
          </InfoModal>


          {/* Legal Disclaimer Modal (detailed) */}
          <InfoModal
            open={disclaimerModalOpen}
            onClose={() => setDisclaimerModalOpen(false)}
            title={<><Info className="w-6 h-6 text-orange-300" />Legal Disclaimer</>}
            ariaLabel="Legal Disclaimer"
          >
            <div className="w-full max-w-2xl mx-auto space-y-6">
              <div className="h-52"></div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <p className="text-sm text-gray-700 dark:text-gray-300">This application and the data it surfaces are provided for informational, educational, and research purposes only. Nothing presented by this app is intended to be, and should not be construed as, financial, investment, tax, or legal advice. Use of this app does not create any advisory relationship.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">No Financial Advice</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">Any signals, metrics, or analysis presented here are not recommendations to buy, sell, or hold any assets. Users should perform their own due diligence and consult a licensed financial advisor before making decisions.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">No Guarantees &amp; Accuracy</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">Data may be delayed, incomplete, or inaccurate. We make no warranties regarding the completeness, timeliness, or accuracy of the information provided. All content is provided 'as is' without warranty of any kind.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">Limitation of Liability</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">We and our affiliates shall not be liable for any loss or damage arising from the use of the app or reliance on any information presented. You assume full responsibility for any investment decisions you make.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">Consult a Professional</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">If you need individual advice, consult a licensed financial, tax, or legal advisor. The app is not a substitute for professional advice.</p>
              </div>
              <div className="text-right">
                <button type="button" className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => setDisclaimerModalOpen(false)}>I Understand</button>
              </div>
            </div>
          </InfoModal>

          {/* Stop Loss Reminder Modal (detailed) */}
          <InfoModal
            open={stopLossModalOpen}
            onClose={() => setStopLossModalOpen(false)}
            title={<><Info className="w-6 h-6 text-red-400" />Stop Loss Reminder</>}
            ariaLabel="Stop Loss Reminder"
          >
            <div className="w-full max-w-2xl mx-auto space-y-6">
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <p className="text-sm text-gray-700 dark:text-gray-300">A stop loss is an order designed to limit an investor’s loss on a position. Setting a stop loss can help you protect capital and manage risk if a trade moves against you.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-red-600 dark:text-red-300 mb-2">Why set a stop loss</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">Stop losses automatically exit a losing trade at a predetermined price, helping reduce emotional decision-making and ensuring disciplined risk management.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-red-600 dark:text-red-300 mb-2">Common strategies</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">Consider setting stop loss levels based on volatility, below key support levels, or at a predefined percentage loss you are comfortable with. Always test your strategy in a paper environment before trading live.</p>
              </div>
              <div className="text-right">
                <button type="button" className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white" onClick={() => setStopLossModalOpen(false)}>I Understand</button>
              </div>
            </div>
          </InfoModal>

          {/* AI Usage Modal (detailed) */}
          <InfoModal
            open={aiUsageModalOpen}
            onClose={() => setAiUsageModalOpen(false)}
            title={<><Info className="w-6 h-6 text-gray-600" />AI Usage</>}
            ariaLabel="AI Usage"
          >
            <div className="w-full max-w-2xl mx-auto space-y-6">
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-indigo-300 mb-2">How AI is used</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">This application uses language models to summarize market data, provide contextual notes about signals, and support UI summaries. The outputs are produced by third-party LLMs or local inference systems depending on configuration.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">Limitations & behavior</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">LLMs are probabilistic and may produce incorrect or misleading information (hallucinations). They can reflect biases present in training data and should not be relied upon as authoritative financial advice. Always cross-check with charts, numerical data, and consult a licensed professional for trading decisions.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">Privacy & data</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">We do not submit personally-identifying information to LLMs unless explicitly stated. Aggregated and non-identifying telemetry may be used to evaluate and improve models. Avoid pasting sensitive personal or account details in places that may be sent to third-party services.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mb-2">Recommendations</h5>
                <p className="text-xs text-gray-700 dark:text-gray-300">Treat AI summaries as a convenience and starting point for analysis. Verify important conclusions using the provided charts, raw data, and other trusted sources before acting.</p>
              </div>
              <div className="text-right">
                <button type="button" className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => setAiUsageModalOpen(false)}>I Understand</button>
              </div>
            </div>
          </InfoModal>

          {/* Info Modal for Live Setup Scans (refactored into InfoModal) */}
          <InfoModal
            open={signalFeedInfoOpen}
            onClose={() => setSignalFeedInfoOpen(false)}
            verticalAlign="top"
            title={<><Info className="w-6 h-6 text-gray-900 dark:text-orange-300" />About Live Setup Scans</>}
            ariaLabel="About Live Setup Scans"
          >
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-indigo-300 mb-2">What is the Live Setup Scans Feed?</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">The Live Setup Scans section provides real-time actionable trading setups detected by our AI. Each card summarizes a unique market opportunity, including the ticker, setup type, confluence factors, timeframe, and recent price change. Use these signals to quickly identify high-probability entries, reversals, breakouts, and consolidations across the market.</p>
              </div>

              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                <h5 className="text-lg font-bold text-gray-900 dark:text-indigo-300 mb-2">How to Use</h5>
                <p className="text-sm text-gray-700 dark:text-gray-300">Review the confluence factors for each setup to understand why the signal was generated. Add setups to your watchlist or view charts for deeper analysis. The feed updates continuously to reflect the latest market conditions.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-indigo-300 mb-3">Key Patterns & Signals</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">These signal definitions and setups are the foundations of many of the Live Setup Scans. Use them to better interpret why a signal was raised and how to act on it.</p>

              <div data-testid="education-cards-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {signalEducationCards.map((c, i) => (
                  <SignalEducationCard
                    key={i}
                    title={c.title}
                    subtitle={c.subtitle}
                    description={c.description}
                    examples={c.examples}
                    badge={c.badge}
                    Icon={c.Icon}
                  />
                ))}
              </div>
            
              </div>
            </div>
          </InfoModal>

          {/* Disclaimers & Risk Notices (moved into a collapsible section at the bottom) */}
          <DisclaimersSection
            isLoading={isLoading}
            setStopLossModalOpen={setStopLossModalOpen}
            setDisclaimerModalOpen={setDisclaimerModalOpen}
            setAiUsageModalOpen={setAiUsageModalOpen}
          />

          {/* Spacer */}
          <div className='mb-64 lg:mb-0'></div>

        </div>
      </div>

      {/* Hide BottomNav when modal is open */}
      {!(modalOpen || infoModalOpen || signalFeedInfoOpen || disclaimerModalOpen || stopLossModalOpen || aiUsageModalOpen) && (
        <div className="fixed bottom-0 left-0 w-full z-40">
          {/* ...existing BottomNav code... */}
        </div>
      )}

      {/* Stock Preview Modal */}
      <StockPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        symbol={previewStock?.symbol || ''}
        name={previewStock?.name || ''}
        price={previewStock?.price || 0}
        change={previewStock?.change || 0}
        valueChange={previewStock?.valueChange || 0}
        sparkline={previewStock?.sparkline || []}
        timeframe="day"
      />
    </div>
  );
}