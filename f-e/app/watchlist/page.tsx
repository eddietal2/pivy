"use client";

import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import CandleStickAnim from '../../components/ui/CandleStickAnim';
import WatchListItem from '../../components/watchlist/WatchListItem';
import StockPreviewModal from '../../components/stock/StockPreviewModal';
import LiveScreen from '../../components/watchlist/LiveScreen';
import QuickActionMenu from '../../components/watchlist/QuickActionMenu';
import InfoModal from '../../components/modals/InfoModal';
import MarketStatusIndicator from '@/components/ui/MarketStatusIndicator';
import { Info, LineChart, ChevronDown, ChevronRight, Settings, Star, Search, X, Activity, TrendingUp, TrendingDown, Zap, Clock, Layers, FileText, RefreshCw, Database, Receipt, AlertTriangle } from 'lucide-react';
import { useFavorites, MAX_FAVORITES } from '@/components/context/FavoritesContext';
import { useWatchlist, MAX_WATCHLIST } from '@/components/context/WatchlistContext';
import { useToast } from '@/components/context/ToastContext';
import { usePaperTrading } from '@/components/context/PaperTradingContext';
import LiveScreensContainer from '@/components/screens/LiveScreensContainer';
import { LiveScreen as LiveScreenType, LiveScreenStock, allScreenCategories, categoryConfig, ScreenCategory, allScreenIds, screenTemplates, ScreenId } from '@/types/screens';
import { useMarketPulseData, MARKET_PULSE_TICKER_NAMES, MARKET_PULSE_ASSET_CLASSES } from '@/hooks/useMarketPulseData';
import { useLiveScreensData } from '@/hooks/useLiveScreensData';
import { useWatchlistData } from '@/hooks/useWatchlistData';
import { useMyScreensData } from '@/hooks/useMyScreensData';
import { usePaperTradingData } from '@/hooks/usePaperTradingData';

// Alias imports for backward compatibility with existing code
const tickerNames = MARKET_PULSE_TICKER_NAMES;
const assetClasses = MARKET_PULSE_ASSET_CLASSES;

function WatchlistPageContent() {
  const { favorites, addFavorite, removeFavorite, isFavorite, toggleFavorite } = useFavorites();
  const { watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, toggleWatchlist, reorderWatchlist } = useWatchlist();
  const { showToast } = useToast();
  const { isEnabled: isPaperTradingEnabled, toggleEnabled: togglePaperTrading, account: paperTradingAccount, positions: paperTradingPositions, optionPositions: paperTradingOptionPositions, isLoading: isPaperTradingLoading, hasPosition, refreshAccount } = usePaperTrading();
  const searchParams = useSearchParams();
  const [pulseTimeframe, setPulseTimeframe] = useState<'D'|'W'|'M'|'Y'>('D');
  
  // Drag-to-reorder state for watchlist items
  const [watchlistDragIndex, setWatchlistDragIndex] = useState<number | null>(null);
  const [watchlistDragOverIndex, setWatchlistDragOverIndex] = useState<number | null>(null);
  // Refs to track current drag state (avoids closure issues)
  const watchlistDragIndexRef = useRef<number | null>(null);
  const watchlistDragOverIndexRef = useRef<number | null>(null);
  
  // Confirmation dialog for removing last item
  const [lastItemRemoveConfirm, setLastItemRemoveConfirm] = useState<{
    isOpen: boolean;
    symbol: string;
    name: string;
    listType: 'watchlist' | 'screens';
    wasInScreens?: boolean;
  } | null>(null);
  
  // Track recently added items for pulse animation
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [recentlyAddedToScreens, setRecentlyAddedToScreens] = useState<Set<string>>(new Set());
  
  // Quick action menu state
  const [quickActionMenu, setQuickActionMenu] = useState<{
    isOpen: boolean;
    symbol: string;
    name: string;
    position: { x: number; y: number };
  } | null>(null);
  // Track active tab for swipeable navigation (0: Market Pulse, 1: Live Screens, 2: My Watchlist, 3: My Screens, 4: Paper Trading)
  // Initialize with default value to avoid hydration mismatch, then restore from localStorage after mount
  const [activeTab, setActiveTab] = useState(0);
  // Track which section is open (accordion behavior - only one open at a time)
  const [activeSection, setActiveSection] = useState<'marketPulse' | 'swingScreening' | 'myWatchlist' | 'liveScreens' | 'paperTrading' | null>('marketPulse');
  
  // Restore tab from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const saved = localStorage.getItem('watchlistActiveTab');
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 4) {
        const sections: ('marketPulse' | 'liveScreens' | 'myWatchlist' | 'swingScreening' | 'paperTrading')[] = ['marketPulse', 'liveScreens', 'myWatchlist', 'swingScreening', 'paperTrading'];
        setActiveTab(parsed);
        setActiveSection(sections[parsed]);
      }
    }
  }, []);
  
  // Ref for nav container to auto-scroll
  const navContainerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll nav to active tab
  useEffect(() => {
    if (navContainerRef.current) {
      const container = navContainerRef.current;
      const activeButton = container.querySelector(`button[data-tab="${String(activeTab)}"]`);
      if (activeButton) {
        // Scroll to the active button with a small delay for smooth animation
        setTimeout(() => {
          activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
        }, 0);
      }
    }
  }, [activeTab]);
  
  // Track swipe gesture
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [touchStartYSwipe, setTouchStartYSwipe] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipingTab, setIsSwipingTab] = useState(false);
  const [isSwipeGestureLocked, setIsSwipeGestureLocked] = useState<'horizontal' | 'vertical' | 'disabled' | null>(null);
  // Track if fixed header should be shown
  const [showFixedHeader, setShowFixedHeader] = useState(false);
  // Track drawer open state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Alert visibility state - persisted in localStorage
  // Start with null to indicate "not yet checked" - prevents skeleton flash
  const [isAlertVisible, setIsAlertVisible] = useState<boolean | null>(null);
  const [isAlertClosing, setIsAlertClosing] = useState(false);
  const [showAlertDismissConfirm, setShowAlertDismissConfirm] = useState(false);
  
  // Check localStorage for alert dismissal after hydration
  useEffect(() => {
    const dismissed = localStorage.getItem('pivyWatchlistAlertDismissed') === 'true';
    setIsAlertVisible(!dismissed);
  }, []);
  // Market Pulse info modal state
  const [isMarketPulseInfoOpen, setIsMarketPulseInfoOpen] = useState(false);
  // My Watchlist info modal state
  const [isMyWatchlistInfoOpen, setIsMyWatchlistInfoOpen] = useState(false);
  // My Screens info modal state
  const [isMyScreensInfoOpen, setIsMyScreensInfoOpen] = useState(false);
  // Live Screens info modal state
  const [isLiveScreensInfoOpen, setIsLiveScreensInfoOpen] = useState(false);
  // Paper Trading info modal state
  const [isPaperTradingInfoOpen, setIsPaperTradingInfoOpen] = useState(false);
  // Search drawer state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; name: string; type?: string; exchange?: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchDebounceRef = React.useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = React.useRef<AbortController | null>(null);
  // Track collapsible section states
  const [section2Expanded, setSection2Expanded] = useState(false);
  const [section3Expanded, setSection3Expanded] = useState(false);
  const [displaySettingsExpanded, setDisplaySettingsExpanded] = useState(false);
  
  // Display Settings (persisted in localStorage)
  const [compactMode, setCompactMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('watchlistCompactMode') === 'true';
    }
    return false;
  });
  
  const [showSparklines, setShowSparklines] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistShowSparklines');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  const [showAfterHours, setShowAfterHours] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistShowAfterHours');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  const [showRelativeVolume, setShowRelativeVolume] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistShowRV');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  const [priceChangeFormat, setPriceChangeFormat] = useState<'percent' | 'dollar' | 'both'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistPriceChangeFormat');
      if (['percent', 'dollar', 'both'].includes(saved || '')) {
        return saved as 'percent' | 'dollar' | 'both';
      }
    }
    return 'both';
  });
  
  // Data Settings (persisted in localStorage)
  const [dataSettingsExpanded, setDataSettingsExpanded] = useState(false);
  
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<15 | 30 | 60 | 0>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistAutoRefreshInterval');
      if (saved && [15, 30, 60, 0].includes(Number(saved))) {
        return Number(saved) as 15 | 30 | 60 | 0;
      }
    }
    return 30; // Default 30s
  });
  
  const [defaultTimeframe, setDefaultTimeframe] = useState<'day' | 'week' | 'month' | 'year'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistDefaultTimeframe');
      if (['day', 'week', 'month', 'year'].includes(saved || '')) {
        return saved as 'day' | 'week' | 'month' | 'year';
      }
    }
    return 'day';
  });
  
  const [showExtendedHoursData, setShowExtendedHoursData] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistShowExtendedHoursData');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  // Watchlist Settings (persisted in localStorage)
  const [watchlistSettingsExpanded, setWatchlistSettingsExpanded] = useState(false);
  
  const [doubleTapAction, setDoubleTapAction] = useState<'screens' | 'detail' | 'trade'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistDoubleTapAction');
      if (['screens', 'detail', 'trade'].includes(saved || '')) {
        return saved as 'screens' | 'detail' | 'trade';
      }
    }
    return 'screens'; // Default: Add to My Screens
  });
  
  const [swipeToDeleteEnabled, setSwipeToDeleteEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistSwipeToDelete');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  const [confirmLastItemRemoval, setConfirmLastItemRemoval] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistConfirmLastItem');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  const [autoSortWatchlist, setAutoSortWatchlist] = useState<'manual' | 'change' | 'name' | 'recent'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlistAutoSort');
      if (['manual', 'change', 'name', 'recent'].includes(saved || '')) {
        return saved as 'manual' | 'change' | 'name' | 'recent';
      }
    }
    return 'manual'; // Default: Manual ordering
  });
  
  // Market Pulse Settings
  const [marketPulseSettingsExpanded, setMarketPulseSettingsExpanded] = useState(false);
  
  // Hidden asset classes (persisted in localStorage)
  const [hiddenAssetClasses, setHiddenAssetClasses] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('marketPulseHiddenClasses');
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch {
          return new Set();
        }
      }
    }
    return new Set();
  });
  
  // Collapsed by default setting (persisted in localStorage)
  const [assetClassesCollapsedByDefault, setAssetClassesCollapsedByDefault] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('marketPulseCollapsedByDefault') === 'true';
    }
    return false;
  });
  
  // Show top indicators in header (persisted in localStorage)
  const [showTopIndicatorsInHeader, setShowTopIndicatorsInHeader] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('marketPulseShowTopIndicators');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  // Paper Trading Settings
  const [paperTradingSettingsExpanded, setPaperTradingSettingsExpanded] = useState(false);
  
  // P/L Display Format: '$' | '%' | 'both'
  const [plDisplayFormat, setPlDisplayFormat] = useState<'$' | '%' | 'both'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('paperTradingPlFormat');
      if (saved === '$' || saved === '%' || saved === 'both') return saved;
    }
    return 'both'; // Default: show both
  });
  
  // Default Order Type: 'market' | 'limit'
  const [defaultOrderType, setDefaultOrderType] = useState<'market' | 'limit'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('paperTradingOrderType');
      if (saved === 'market' || saved === 'limit') return saved;
    }
    return 'market'; // Default: market orders
  });
  
  // Confirm Before Trades
  const [confirmBeforeTrades, setConfirmBeforeTrades] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('paperTradingConfirmTrades');
      return saved !== 'false'; // Default true
    }
    return true;
  });
  
  // Reset Account confirmation modal
  const [showResetAccountModal, setShowResetAccountModal] = useState(false);
  
  // Starting Cash Balance for Paper Trading
  const [startingCashBalance, setStartingCashBalance] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('paperTradingStartingBalance');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 1000 && parsed <= 10000000) return parsed;
      }
    }
    return 100000; // Default: $100,000
  });
  
  // Track selected Live Screen IDs (individual screens)
  const [selectedScreenIds, setSelectedScreenIds] = useState<ScreenId[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('selectedScreenIds');
      if (saved) return JSON.parse(saved);
    }
    // Default: all 8 screens
    return [...allScreenIds];
  });
  // Track selected timeframe for market data (initialized from defaultTimeframe)
  const [selectedTimeframe, setSelectedTimeframe] = useState<'day' | 'week' | 'month' | 'year'>(defaultTimeframe);
  // Track brief loading state when switching timeframes
  const [timeframeSwitching, setTimeframeSwitching] = useState(false);

  // Asset class dropdown expanded state - respects collapsedByDefault setting
  const [expandedAssetClasses, setExpandedAssetClasses] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const collapsedByDefault = localStorage.getItem('marketPulseCollapsedByDefault') === 'true';
      if (collapsedByDefault) {
        return new Set(); // All collapsed
      }
    }
    const keys = Object.keys(assetClasses);
    return new Set(keys.length > 0 ? [keys[0]] : []); // First one expanded by default
  });

  const toggleAssetClassExpanded = useCallback((classKey: string) => {
    setExpandedAssetClasses(prev => {
      const next = new Set(prev);
      if (next.has(classKey)) {
        next.delete(classKey);
      } else {
        next.add(classKey);
      }
      return next;
    });
  }, []);

  // Rearrange mode state
  const [isRearrangeMode, setIsRearrangeMode] = useState(false);
  // Initialize with default order - will be updated from localStorage after mount
  const [assetClassOrder, setAssetClassOrder] = useState<string[]>(Object.keys(assetClasses));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [touchCurrentIndex, setTouchCurrentIndex] = useState<number | null>(null);
  const [showReorderSkeleton, setShowReorderSkeleton] = useState(false);

  // Market Pulse item ordering within each asset class
  const [pulseItemOrder, setPulseItemOrder] = useState<Record<string, string[]>>({});
  const [pulseDragState, setPulseDragState] = useState<{
    classKey: string;
    fromIndex: number;
    overIndex: number | null;
  } | null>(null);
  // Ref to track current pulse drag state (avoids closure issues)
  const pulseDragStateRef = useRef<{
    classKey: string;
    fromIndex: number;
    overIndex: number | null;
  } | null>(null);

  // Selected stock for preview modal
  const [selectedStock, setSelectedStock] = useState<{
    symbol: string;
    name: string;
    price: number;
    change: number;
    valueChange: number;
    sparkline: number[];
    timeframe: string;
    timeframes?: {
      day?: { closes: number[]; latest: { close: string; change: number; value_change: number; is_after_hours: boolean } };
      week?: { closes: number[]; latest: { close: string; change: number; value_change: number; is_after_hours: boolean } };
      month?: { closes: number[]; latest: { close: string; change: number; value_change: number; is_after_hours: boolean } };
      year?: { closes: number[]; latest: { close: string; change: number; value_change: number; is_after_hours: boolean } };
    };
  } | null>(null);

  // Market Pulse data hook - only fetches/polls when Tab 0 is active
  const {
    data: marketPulseData,
    loading: marketPulseLoading,
    error: marketPulseError,
    retryCount: marketPulseRetryCount,
    backendReady: marketPulseBackendReady,
    refresh: refreshMarketPulse,
  } = useMarketPulseData({
    isActive: activeTab === 0,
    pollingInterval: autoRefreshInterval === 0 ? 0 : autoRefreshInterval * 1000,
  });

  // Live Screens data hook - only fetches/polls when Tab 1 is active
  const {
    data: liveScreensData,
    loading: liveScreensLoading,
    error: liveScreensError,
    warmingUp: liveScreensWarmingUp,
    refresh: refreshLiveScreens,
  } = useLiveScreensData({
    isActive: activeTab === 1,
    selectedScreenIds,
    pollingInterval: autoRefreshInterval === 0 ? 0 : Math.max(autoRefreshInterval * 1000, 60000), // Min 60s for screens
  });

  // My Watchlist data hook - only fetches/polls when Tab 2 is active
  const watchlistSymbols = React.useMemo(() => watchlist.map(w => w.symbol), [watchlist]);
  
  const {
    data: watchlistMarketData,
    loading: watchlistLoading,
    error: watchlistError,
    retryCount: watchlistRetryCount,
    backendReady: watchlistBackendReady,
    refresh: refreshWatchlist,
  } = useWatchlistData({
    isActive: activeTab === 2,
    symbols: watchlistSymbols,
    pollingInterval: autoRefreshInterval === 0 ? 0 : autoRefreshInterval * 1000,
  });

  // My Screens data hook - only fetches/polls when Tab 3 is active
  const favoritesSymbols = React.useMemo(() => favorites.map(f => f.symbol), [favorites]);
  const {
    data: myScreensData,
    loading: myScreensLoading,
    error: myScreensError,
    retryCount: myScreensRetryCount,
    refresh: refreshMyScreens,
  } = useMyScreensData({
    isActive: activeTab === 3,
    symbols: favoritesSymbols,
    pollingInterval: autoRefreshInterval === 0 ? 0 : Math.max(autoRefreshInterval * 1000, 60000), // Min 60s for indicators
  });

  // Paper Trading data hook - only fetches/polls when Tab 4 is active
  const positionSymbols = React.useMemo(
    () => paperTradingPositions.map(p => p.symbol),
    [paperTradingPositions]
  );
  const {
    data: paperTradingMarketData,
    loading: paperTradingDataLoading,
    error: paperTradingDataError,
    refresh: refreshPaperTradingData,
  } = usePaperTradingData({
    isActive: activeTab === 4 && isPaperTradingEnabled,
    positionSymbols,
    pollingInterval: autoRefreshInterval === 0 ? 0 : autoRefreshInterval * 1000,
  });

  // Derive state for Market Pulse tab (Tab 0)
  // Use appropriate data source based on active tab
  const marketData: Record<string, any> = React.useMemo(() => {
    if (activeTab === 0) return marketPulseData;
    if (activeTab === 2) return watchlistMarketData;
    if (activeTab === 4) return paperTradingMarketData;
    return {};
  }, [activeTab, marketPulseData, watchlistMarketData, paperTradingMarketData]);
  
  // Sorted watchlist based on autoSortWatchlist setting
  const sortedWatchlist = React.useMemo(() => {
    if (autoSortWatchlist === 'manual') {
      return watchlist;
    }
    
    const sorted = [...watchlist];
    switch (autoSortWatchlist) {
      case 'change':
        // Sort by change % (highest first)
        sorted.sort((a, b) => {
          const aData = marketData[a.symbol];
          const bData = marketData[b.symbol];
          const aChange = aData?.change ?? 0;
          const bChange = bData?.change ?? 0;
          return Math.abs(bChange) - Math.abs(aChange); // Highest absolute change first
        });
        break;
      case 'name':
        // Sort alphabetically by symbol
        sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
        break;
      case 'recent':
        // Reverse order (most recently added first - assuming items are added to end)
        sorted.reverse();
        break;
    }
    return sorted;
  }, [watchlist, autoSortWatchlist, marketData]);
  
  const loading = React.useMemo(() => {
    if (activeTab === 0) return marketPulseLoading;
    if (activeTab === 2) return watchlistLoading;
    if (activeTab === 3) return myScreensLoading;
    if (activeTab === 4) return paperTradingDataLoading;
    return false;
  }, [activeTab, marketPulseLoading, watchlistLoading, myScreensLoading, paperTradingDataLoading]);
  
  const error = React.useMemo(() => {
    if (activeTab === 0) return marketPulseError;
    if (activeTab === 2) return watchlistError;
    if (activeTab === 3) return myScreensError;
    if (activeTab === 4) return paperTradingDataError;
    return null;
  }, [activeTab, marketPulseError, watchlistError, myScreensError, paperTradingDataError]);
  
  const retryCount = React.useMemo(() => {
    if (activeTab === 0) return marketPulseRetryCount;
    if (activeTab === 2) return watchlistRetryCount;
    if (activeTab === 3) return myScreensRetryCount;
    return 0;
  }, [activeTab, marketPulseRetryCount, watchlistRetryCount, myScreensRetryCount]);
  
  const backendReady = React.useMemo(() => {
    if (activeTab === 0) return marketPulseBackendReady;
    if (activeTab === 2) return watchlistBackendReady;
    return true;
  }, [activeTab, marketPulseBackendReady, watchlistBackendReady]);

  // Unified refresh function for current tab
  const handleRefresh = useCallback(() => {
    switch (activeTab) {
      case 0: refreshMarketPulse(); break;
      case 1: refreshLiveScreens(); break;
      case 2: refreshWatchlist(); break;
      case 3: refreshMyScreens(); break;
      case 4: refreshPaperTradingData(); break;
    }
  }, [activeTab, refreshMarketPulse, refreshLiveScreens, refreshWatchlist, refreshMyScreens, refreshPaperTradingData]);

  const [mounted, setMounted] = useState(false);

  const collapsibleSectionRef = React.useRef<HTMLDivElement>(null);

  // Normalize timeframe string to a category: D, W, M, Y
  const normalizeTimeframe = (tf?: string) => {
    if (!tf) return 'D';
    const t = tf.toUpperCase();
    if (t.includes('24H') || t.endsWith('D') || t.includes('DAY') || t === '1D') return 'D';
    if (t.includes('W') || t.includes('WEEK')) return 'W';
    if (t.includes('M') && !t.includes('MS')) return 'M';
    if (t.includes('Y') || t.includes('YEAR')) return 'Y';
    return 'D';
  };

  // Filter pulses by chosen timeframe and group by asset class (prefer backend market data when available)
  const groupedPulse = React.useMemo(() => {
    const backendEntries = Object.keys(marketData || {});
    if (backendEntries.length > 0) {
      const grouped: Record<string, any[]> = {};

      // Initialize groups
      Object.keys(assetClasses).forEach(classKey => {
        grouped[classKey] = [];
      });

      backendEntries.forEach((ticker) => {
        const timeframeData = marketData[ticker]?.timeframes?.[selectedTimeframe];
        const item = {
          ticker: tickerNames[ticker] || ticker,
          symbol: ticker,
          price: timeframeData?.latest?.close || 'N/A',
          change: timeframeData?.latest?.change ?? 0,
          valueChange: timeframeData?.latest?.value_change ?? 0,
          sparkline: timeframeData?.closes ?? [],
          timeframe: selectedTimeframe.toUpperCase(),
          afterHours: timeframeData?.latest?.is_after_hours ?? false,
          rv: marketData[ticker]?.rv ?? null
        };

        // Find which asset class this ticker belongs to
        let foundClass: string | null = null;
        for (const [classKey, classData] of Object.entries(assetClasses)) {
          if (classData.tickers.includes(ticker)) {
            foundClass = classKey;
            break;
          }
        }
        // Only add if we found a valid asset class for this ticker
        if (foundClass && grouped[foundClass]) {
          grouped[foundClass].push(item);
        }
      });

      // Apply custom order for each asset class if saved
      Object.keys(grouped).forEach(classKey => {
        const savedOrder = pulseItemOrder[classKey];
        if (savedOrder && savedOrder.length > 0) {
          grouped[classKey].sort((a, b) => {
            const aIndex = savedOrder.indexOf(a.symbol);
            const bIndex = savedOrder.indexOf(b.symbol);
            // Items not in saved order go to the end
            if (aIndex === -1 && bIndex === -1) return 0;
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
          });
        }
      });

      return grouped;
    }

    // Return empty groups when loading or no data
    const emptyGrouped: Record<string, any[]> = {};
    Object.keys(assetClasses).forEach(classKey => {
      emptyGrouped[classKey] = [];
    });
    return emptyGrouped;
  }, [marketData, selectedTimeframe, pulseItemOrder]);

  // Calculate top bullish and bearish indicators from market data
  // Exclude sentiment indices and futures (contract rollovers cause misleading % changes)
  const EXCLUDED_FROM_TOP_INDICATORS = [
    'CRYPTO-FEAR-GREED', '^VIX', 'CALL/PUT Ratio',  // Sentiment indices
    'NG=F', 'CL=F', 'GC=F', 'SI=F', 'HG=F', 'PL=F', 'PA=F',  // Futures (rollover issues)
  ];
  
  type TopIndicator = { ticker: string; symbol: string; change: number } | null;
  const topIndicators = React.useMemo<{ bullish: TopIndicator; bearish: TopIndicator }>(() => {
    const entries = Object.entries(marketData || {});
    if (entries.length === 0) return { bullish: null, bearish: null };
    
    let maxChange = -Infinity;
    let minChange = Infinity;
    let bullishItem: TopIndicator = null;
    let bearishItem: TopIndicator = null;

    entries.forEach(([ticker, tickerData]: [string, any]) => {
      // Skip sentiment indices and futures - their change % can be misleading
      if (EXCLUDED_FROM_TOP_INDICATORS.includes(ticker)) return;
      
      const dayTimeframe = tickerData?.timeframes?.day;
      const change = dayTimeframe?.latest?.change ?? tickerData?.change ?? 0;
      
      if (change > maxChange) {
        maxChange = change;
        bullishItem = {
          ticker: tickerNames[ticker] || ticker,
          symbol: ticker,
          change: change,
        };
      }
      
      if (change < minChange) {
        minChange = change;
        bearishItem = {
          ticker: tickerNames[ticker] || ticker,
          symbol: ticker,
          change: change,
        };
      }
    });

    return { bullish: bullishItem, bearish: bearishItem };
  }, [marketData]);

  // Reorder pulse items within an asset class
  const reorderPulseItems = useCallback((classKey: string, fromIndex: number, toIndex: number) => {
    const items = groupedPulse[classKey] || [];
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return;
    
    // Get the current order (or create from current items)
    const currentOrder = pulseItemOrder[classKey] || items.map(item => item.symbol);
    const newOrder = [...currentOrder];
    const [removed] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, removed);
    
    const newPulseOrder = { ...pulseItemOrder, [classKey]: newOrder };
    setPulseItemOrder(newPulseOrder);
    localStorage.setItem('pulseItemOrder', JSON.stringify(newPulseOrder));
  }, [groupedPulse, pulseItemOrder]);

  // Helper to trigger pulse animation on newly added items
  const triggerAddedPulse = useCallback((symbol: string) => {
    setRecentlyAdded(prev => new Set(prev).add(symbol));
    // Remove from set after animation completes (1.5 seconds)
    setTimeout(() => {
      setRecentlyAdded(prev => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }, 1500);
  }, []);

  // Helper to trigger purple pulse animation for My Screens additions
  const triggerAddedPulsePurple = useCallback((symbol: string) => {
    setRecentlyAddedToScreens(prev => new Set(prev).add(symbol));
    // Remove from set after animation completes (1.5 seconds)
    setTimeout(() => {
      setRecentlyAddedToScreens(prev => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }, 1500);
  }, []);

  // Touch drag handler - finds element at touch position and updates drag-over state
  const handleWatchlistTouchDrag = useCallback((touchY: number) => {
    // Find the element at the touch point
    const elements = document.elementsFromPoint(window.innerWidth / 2, touchY);
    for (const el of elements) {
      const dragIndex = el.getAttribute?.('data-drag-index');
      if (dragIndex !== null && dragIndex !== undefined) {
        const index = parseInt(dragIndex, 10);
        if (!isNaN(index) && index !== watchlistDragOverIndexRef.current) {
          setWatchlistDragOverIndex(index);
          watchlistDragOverIndexRef.current = index;
        }
        break;
      }
    }
  }, []);

  // Touch drag handler for Market Pulse items
  const handlePulseTouchDrag = useCallback((classKey: string, touchY: number) => {
    const elements = document.elementsFromPoint(window.innerWidth / 2, touchY);
    for (const el of elements) {
      const dragIndex = el.getAttribute?.('data-drag-index');
      if (dragIndex !== null && dragIndex !== undefined) {
        const index = parseInt(dragIndex, 10);
        if (!isNaN(index) && pulseDragStateRef.current?.overIndex !== index) {
          const newState = pulseDragStateRef.current ? { ...pulseDragStateRef.current, overIndex: index } : null;
          setPulseDragState(newState);
          pulseDragStateRef.current = newState;
        }
        break;
      }
    }
  }, []);

  // Loading skeleton component for Market Pulse items
  const PulseSkeleton = () => (
    <div className="bg-white dark:bg-gray-800 p-2 rounded-xl shadow-sm dark:shadow-lg border border-gray-200 dark:border-gray-700 w-full h-24 animate-pulse">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-8"></div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-18 h-7 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="flex flex-col gap-1">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
          </div>
        </div>
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
      </div>
    </div>
  );

  // Loading skeleton component for Asset Class headers
  const AssetClassHeaderSkeleton = () => (
    <div className="flex items-center gap-2 mb-3 animate-pulse">
      <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
    </div>
  );

  // Handle URL search params to navigate to specific tab
  React.useEffect(() => {
    const section = searchParams.get('section');
    if (section === 'watchlist' || section === 'my-watchlist') {
      setActiveTab(2); // My Watchlist tab
      setActiveSection('myWatchlist');
    } else if (section === 'favorites' || section === 'my-screens' || section === 'screens') {
      setActiveTab(3); // My Screens tab
      setActiveSection('swingScreening');
    } else if (section === 'live-screens') {
      setActiveTab(1); // Live Screens tab
      setActiveSection('liveScreens');
    } else if (section === 'market-pulse') {
      setActiveTab(0); // Market Pulse tab
      setActiveSection('marketPulse');
    }
    
    // Handle opening stock modal from URL params (e.g., from options page back button)
    const modalSymbol = searchParams.get('modal');
    if (modalSymbol) {
      const modalPrice = parseFloat(searchParams.get('price') || '0');
      setSelectedStock({
        symbol: modalSymbol,
        name: modalSymbol,
        price: modalPrice,
        change: 0,
        valueChange: 0,
        sparkline: [],
        timeframe: 'day',
      });
    }
  }, [searchParams]);

  // Swipe gesture handling for tab navigation
  // Edge-based detection: only trigger tab swipe when starting from screen edges
  const minSwipeDistance = 100;
  const edgeThreshold = 40; // Only allow tab swipe if starting within 40px of screen edge
  const gestureDirectionThreshold = 20;
  
  const onTouchStart = (e: React.TouchEvent) => {
    const touchX = e.targetTouches[0].clientX;
    const screenWidth = window.innerWidth;
    
    // Check if touch started from an edge
    const isFromLeftEdge = touchX <= edgeThreshold;
    const isFromRightEdge = touchX >= screenWidth - edgeThreshold;
    
    setTouchEnd(null);
    setTouchStart(touchX);
    setTouchStartYSwipe(e.targetTouches[0].clientY);
    setIsSwipingTab(false);
    // Only allow tab swipe if starting from an edge
    setIsSwipeGestureLocked(isFromLeftEdge || isFromRightEdge ? null : 'disabled');
  };
  
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null || touchStartYSwipe === null) return;
    // If swipe is disabled (not from edge), don't process
    if (isSwipeGestureLocked === 'disabled') return;
    
    const currentTouchX = e.targetTouches[0].clientX;
    const currentTouchY = e.targetTouches[0].clientY;
    const deltaX = Math.abs(currentTouchX - touchStart);
    const deltaY = Math.abs(currentTouchY - touchStartYSwipe);
    
    // Lock gesture direction once we've moved enough
    if (isSwipeGestureLocked === null && (deltaX > gestureDirectionThreshold || deltaY > gestureDirectionThreshold)) {
      // Only allow horizontal swipe if horizontal movement is significantly greater than vertical
      if (deltaX > deltaY * 2.0) {
        setIsSwipeGestureLocked('horizontal');
        setIsSwipingTab(true);
      } else {
        setIsSwipeGestureLocked('vertical');
        setIsSwipingTab(false);
      }
    }
    
    // Only update swipe offset if we're in a horizontal gesture
    if (isSwipeGestureLocked === 'horizontal') {
      setTouchEnd(currentTouchX);
      const distance = currentTouchX - touchStart;
      // Limit swipe offset to prevent overscroll
      const maxOffset = 100;
      setSwipeOffset(Math.max(-maxOffset, Math.min(maxOffset, distance)));
    }
  };
  
  const onTouchEnd = () => {
    // Only process swipe if gesture was locked as horizontal
    if (!touchStart || !touchEnd || isSwipeGestureLocked !== 'horizontal') {
      setIsSwipingTab(false);
      setSwipeOffset(0);
      setIsSwipeGestureLocked(null);
      setTouchStart(null);
      setTouchEnd(null);
      setTouchStartYSwipe(null);
      return;
    }
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe && activeTab < 3) {
      const newTab = activeTab + 1;
      setActiveTab(newTab);
      // Sync activeSection with tab
      const sections: ('marketPulse' | 'liveScreens' | 'myWatchlist' | 'swingScreening')[] = ['marketPulse', 'liveScreens', 'myWatchlist', 'swingScreening'];
      setActiveSection(sections[newTab]);
      // Persist and scroll to top
      localStorage.setItem('watchlistActiveTab', newTab.toString());
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (isRightSwipe && activeTab > 0) {
      const newTab = activeTab - 1;
      setActiveTab(newTab);
      const sections: ('marketPulse' | 'liveScreens' | 'myWatchlist' | 'swingScreening')[] = ['marketPulse', 'liveScreens', 'myWatchlist', 'swingScreening'];
      setActiveSection(sections[newTab]);
      // Persist and scroll to top
      localStorage.setItem('watchlistActiveTab', newTab.toString());
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    
    setTouchStart(null);
    setTouchEnd(null);
    setTouchStartYSwipe(null);
    setSwipeOffset(0);
    setIsSwipingTab(false);
    setIsSwipeGestureLocked(null);
  };

  // Tab change handler (syncs activeSection and persists to localStorage)
  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
    const sections: ('marketPulse' | 'liveScreens' | 'myWatchlist' | 'swingScreening' | 'paperTrading')[] = ['marketPulse', 'liveScreens', 'myWatchlist', 'swingScreening', 'paperTrading'];
    setActiveSection(sections[tabIndex]);
    // Persist to localStorage
    localStorage.setItem('watchlistActiveTab', tabIndex.toString());
    // Scroll to top when switching tabs to prevent scroll jump issues
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  React.useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      
      // Show fixed header when user has scrolled down enough that the CollapsibleSection header
      // would be out of view if it weren't sticky
      // Lower threshold for more responsive behavior
      setShowFixedHeader(scrollTop > 40);
    };

    window.addEventListener('scroll', handleScroll);
    // Check initial state
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Set mounted state and load saved asset class order from localStorage
  React.useEffect(() => {
    setMounted(true);
    
    // Load saved order from localStorage after mount
    const saved = localStorage.getItem('assetClassOrder');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Validate that all saved keys exist in assetClasses
        const validKeys = parsed.filter((key: string) => key in assetClasses);
        const missingKeys = Object.keys(assetClasses).filter(key => !parsed.includes(key));
        setAssetClassOrder([...validKeys, ...missingKeys]);
      } catch (e) {
        console.warn('Failed to parse saved asset class order:', e);
      }
    }
    
    // Load saved pulse item order from localStorage
    const savedPulseOrder = localStorage.getItem('pulseItemOrder');
    if (savedPulseOrder) {
      try {
        setPulseItemOrder(JSON.parse(savedPulseOrder));
      } catch (e) {
        console.warn('Failed to parse saved pulse item order:', e);
      }
    }
  }, []);

  // Disable body scroll when drawer is open
  React.useEffect(() => {
    if (isDrawerOpen || isSearchOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen, isSearchOpen]);

  // Focus search input when search drawer opens
  React.useEffect(() => {
    if (isSearchOpen) {
      // Small delay to ensure the drawer animation has started
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isSearchOpen]);

  // Search function that calls the backend API
  const performSearch = React.useCallback(async (query: string) => {
    if (query.length < 1) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    // Abort any in-flight search request
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearchLoading(true);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/market-data/search/?q=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );

      if (!res.ok) {
        throw new Error('Search failed');
      }

      const data = await res.json();
      
      // Also add matching Market Pulse items at the top
      const marketPulseResults: Array<{ symbol: string; name: string; type: string }> = [];
      Object.entries(tickerNames).forEach(([symbol, name]) => {
        if (symbol.toUpperCase().includes(query.toUpperCase()) || name.toUpperCase().includes(query.toUpperCase())) {
          marketPulseResults.push({ symbol, name, type: 'Market Pulse' });
        }
      });

      // Merge results, Market Pulse first, avoiding duplicates
      const apiResults = data.results || [];
      const mergedResults = [...marketPulseResults];
      
      apiResults.forEach((result: { symbol: string; name: string; type?: string }) => {
        if (!mergedResults.find(r => r.symbol === result.symbol)) {
          mergedResults.push({ symbol: result.symbol, name: result.name, type: result.type || 'Stock' });
        }
      });

      setSearchResults(mergedResults.slice(0, 15));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Search error:', err);
      
      // Fallback to local search if API fails
      const results: Array<{ symbol: string; name: string; type: string }> = [];
      Object.entries(tickerNames).forEach(([symbol, name]) => {
        if (symbol.toUpperCase().includes(query.toUpperCase()) || name.toUpperCase().includes(query.toUpperCase())) {
          results.push({ symbol, name, type: 'Market Pulse' });
        }
      });
      setSearchResults(results.slice(0, 10));
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Debounced search handler
  const handleSearchChange = React.useCallback((value: string) => {
    setSearchQuery(value);
    
    // Clear existing debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (value.length < 1) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    
    // Debounce API call by 300ms
    searchDebounceRef.current = setTimeout(() => {
      performSearch(value);
    }, 300);
  }, [performSearch]);

  // Drag and drop handlers for rearranging asset classes
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Create a custom drag image with better positioning
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.opacity = '0.8';
    dragImage.style.transform = 'rotate(2deg) scale(1.02)';
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.pointerEvents = 'none';
    dragImage.style.zIndex = '1000';
    document.body.appendChild(dragImage);

    // Position the drag image at the cursor
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    e.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) return;

    const newOrder = [...assetClassOrder];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);

    setAssetClassOrder(newOrder);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Touch event handlers for mobile drag and drop
  const handleTouchStart = (e: React.TouchEvent, index: number) => {
    setTouchStartY(e.touches[0].clientY);
    setTouchCurrentIndex(index);
    setDraggedIndex(index);

    // Add haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY === null || touchCurrentIndex === null) return;

    const currentY = e.touches[0].clientY;
    const deltaY = Math.abs(currentY - touchStartY);

    // Only start dragging if moved more than 10px
    if (deltaY < 10) return;

    // Find the target index based on the Y position
    const container = e.currentTarget.parentElement;
    if (!container) return;

    const items = container.querySelectorAll('[data-draggable-item]');
    let targetIndex = touchCurrentIndex;

    items.forEach((item, index) => {
      const rect = item.getBoundingClientRect();
      const itemCenter = rect.top + rect.height / 2;
      if (Math.abs(currentY - itemCenter) < rect.height / 2) {
        targetIndex = index;
      }
    });

    if (targetIndex !== touchCurrentIndex) {
      // Reorder the array
      const newOrder = [...assetClassOrder];
      const [draggedItem] = newOrder.splice(touchCurrentIndex, 1);
      newOrder.splice(targetIndex, 0, draggedItem);
      setAssetClassOrder(newOrder);
      setTouchCurrentIndex(targetIndex);
    }
  };

  const handleTouchEnd = () => {
    setTouchStartY(null);
    setTouchCurrentIndex(null);
    setDraggedIndex(null);
  };

  return (
    <div className="min-h-screen pb-62 bg-transparent text-gray-900 dark:bg-transparent dark:text-white font-sans">

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

      {/* Fixed Header and Tab Navigation - mobile only */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="lg:px-64 px-3 sm:px-8">
          {/* Header Section with CandleStick Animation and Search */}
          <div className="flex items-center justify-between py-2 sm:py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0 relative bottom-6.5">
                <CandleStickAnim />
              </span>
              {/* <h1 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">Watchlist</h1> */}
              {/* Market Status Pill - responsive: shows dot+time on mobile, full pill on desktop */}
              <MarketStatusIndicator variant="pill" showNextEvent={false} />
              {/* Top Market Indicators - hidden on very small screens */}
              {showTopIndicatorsInHeader && (
                loading ? (
                  <div className="hidden xs:flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-normal ml-1 sm:ml-2">
                    <span className="flex items-center gap-1">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                      <div className="w-6 sm:w-8 h-2.5 sm:h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                      <div className="w-8 sm:w-10 h-2.5 sm:h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                    </span>
                    <span className="hidden sm:flex items-center gap-1">
                      <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                      <div className="w-8 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                      <div className="w-10 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                    </span>
                  </div>
                ) : (topIndicators.bullish || topIndicators.bearish) && (
                  <div className="hidden xs:flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-normal ml-1 sm:ml-2">
                    {topIndicators.bullish && (
                      <button
                        type="button"
                        onClick={() => {
                          const itemData = marketData[topIndicators.bullish!.symbol];
                          const tfData = itemData?.timeframes?.day;
                          setSelectedStock({
                            symbol: topIndicators.bullish!.symbol,
                            name: topIndicators.bullish!.ticker,
                            price: tfData?.latest?.close ?? itemData?.price ?? 0,
                            change: topIndicators.bullish!.change,
                            valueChange: tfData?.latest?.value_change ?? itemData?.valueChange ?? 0,
                            sparkline: tfData?.closes ?? itemData?.sparkline ?? [],
                            timeframe: 'day',
                            timeframes: itemData?.timeframes,
                          });
                        }}
                        className="flex items-center gap-0.5 sm:gap-1 text-green-500 hover:text-green-600 hover:underline transition-colors"
                      >
                        <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        <span className="text-gray-500 dark:text-gray-400">{topIndicators.bullish.ticker}</span>
                        <span className="font-semibold">+{topIndicators.bullish.change.toFixed(1)}%</span>
                      </button>
                    )}
                    {topIndicators.bearish && (
                      <button
                        type="button"
                        onClick={() => {
                          const itemData = marketData[topIndicators.bearish!.symbol];
                          const tfData = itemData?.timeframes?.day;
                          setSelectedStock({
                            symbol: topIndicators.bearish!.symbol,
                            name: topIndicators.bearish!.ticker,
                            price: tfData?.latest?.close ?? itemData?.price ?? 0,
                            change: topIndicators.bearish!.change,
                            valueChange: tfData?.latest?.value_change ?? itemData?.valueChange ?? 0,
                            sparkline: tfData?.closes ?? itemData?.sparkline ?? [],
                            timeframe: 'day',
                            timeframes: itemData?.timeframes,
                          });
                        }}
                        className="hidden sm:flex items-center gap-1 text-red-500 hover:text-red-600 hover:underline transition-colors"
                      >
                        <TrendingDown className="w-3 h-3" />
                        <span className="text-gray-500 dark:text-gray-400">{topIndicators.bearish.ticker}</span>
                        <span className="font-semibold">{topIndicators.bearish.change.toFixed(1)}%</span>
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
            {!isRearrangeMode && (
              <button
                onClick={() => setIsSearchOpen(true)}
                className="p-1.5 sm:p-2 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
                aria-label="Search stocks"
              >
                <Search className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 dark:text-gray-400" />
              </button>
            )}
          </div>

          {/* Horizontal Text-Based Tab Navigation */}
          <div className="relative flex items-center py-2 sm:py-4">
            {/* Scrollable Nav Links */}
            <div ref={navContainerRef} className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide">
              {[
                { id: 0, label: 'Market Pulse' },
                { id: 1, label: 'Live Screens' },
                { id: 2, label: 'Watchlist' },
                { id: 3, label: 'My Screens' },
                { id: 4, label: 'Paper Trading' },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={`tab-${tab.id}`}
                    data-tab={String(tab.id)}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex-shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area - with top padding for fixed header */}
      <div className="flex-1 overflow-y-auto lg:px-64 pt-[5em] sm:pt-[7em] md:pt-20">
        <div className="p-4 sm:p-8 pt-2 sm:pt-4">

          {/* Desktop-only: inline tabs + search */}
          <div className="hidden md:flex items-center justify-between mb-5">
            <div className="flex items-center gap-1.5">
              {[
                { id: 0, label: 'Market Pulse' },
                { id: 1, label: 'Live Screens' },
                { id: 2, label: 'Watchlist' },
                { id: 3, label: 'My Screens' },
                { id: 4, label: 'Paper Trading' },
              ].map((tab) => (
                <button
                  key={`dtab-${tab.id}`}
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {!isRearrangeMode && (
              <button
                onClick={() => setIsSearchOpen(true)}
                className="p-1.5 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                aria-label="Search stocks"
              >
                <Search className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>
            )}
          </div>

          {/* Swipeable Content Container */}
          <div 
            className="relative overflow-hidden -mx-4 sm:-mx-8"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div 
              className="flex transition-transform duration-300 ease-out"
              style={{ 
                transform: `translateX(calc(-${activeTab * 100}% + ${isSwipingTab ? swipeOffset : 0}px))`,
              }}
            >
              {/* Tab 0: Market Pulse */}
              <div className="w-full flex-shrink-0 px-6 sm:px-10 pt-2 pb-8">

          {/* Getting Started Alert - only render after hydration check (isAlertVisible !== null) */}
          {isAlertVisible === true && (
            <div 
              className={`relative bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl transform transition-all duration-300 ${isAlertClosing ? 'max-h-0 p-0 opacity-0 border-0' : 'max-h-[500px] p-4'}`}
              style={{ overflow: 'hidden' }}
            >
              {/* Close button - top right */}
              <button 
                onClick={() => setShowAlertDismissConfirm(true)}
                className="absolute top-3 right-3 p-1 hover:bg-blue-100 dark:hover:bg-blue-800/50 rounded transition-colors"
              >
                <X className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </button>
              
              {/* Centered Logo */}
            <div className="flex justify-center mb-3">
              <div className="scale-75">
                <CandleStickAnim />
              </div>
            </div>
            
            <div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2 text-center">
                    How Pivy Watchlist Works
                  </h3>
                  <ol className="text-xs text-blue-800 dark:text-blue-200 space-y-1.5">
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-4 h-4 bg-blue-200 dark:bg-blue-700 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-200">1</span>
                      <span><strong>Search or Browse</strong> — Find assets using the search bar or explore the Market Pulse section</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-4 h-4 bg-blue-200 dark:bg-blue-700 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-200">2</span>
                      <span><strong>Live Screens</strong> — Browse AI-curated daily stock screens. Double-tap stocks to add to Watchlist</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-4 h-4 bg-blue-200 dark:bg-blue-700 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-200">3</span>
                      <span><strong>Build Your Watchlist</strong> — Tap ⭐ to add up to 10 assets you want to track</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-4 h-4 bg-blue-200 dark:bg-blue-700 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-200">4</span>
                      <span><strong>Add to My Screens</strong> — Double-tap watchlist items or tap 
                        <TrendingUp className="w-3.5 h-3.5 mx-1 relative bottom-0.5 inline text-purple-500" />
                        to add them to My Screens for swing trade analysis</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-4 h-4 bg-blue-200 dark:bg-blue-700 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-200">5</span>
                      <span><strong>Paper Trading</strong> — Practice trading with virtual funds. Buy & sell stocks risk-free to test your strategies</span>
                    </li>
                  </ol>
                </div>
              </div>
              
              {/* Dismiss Confirmation - animated expand/collapse */}
              <div 
                className={`overflow-hidden transition-all duration-300 ease-out ${
                  showAlertDismissConfirm 
                    ? 'max-h-24 opacity-100 mt-3' 
                    : 'max-h-0 opacity-0 mt-0'
                }`}
              >
                <div className="pt-3 border-t border-blue-200 dark:border-blue-700">
                  <p className="text-xs text-blue-800 dark:text-blue-200 mb-2">
                    Are you sure you want to close these instructions? This cannot be undone.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowAlertDismissConfirm(false)}
                      className="px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/50 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setShowAlertDismissConfirm(false);
                        setIsAlertClosing(true);
                        localStorage.setItem('pivyWatchlistAlertDismissed', 'true');
                        setTimeout(() => setIsAlertVisible(false), 300);
                      }}
                      className="px-3 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700 rounded transition-colors"
                    >
                      Yes, Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Global Market Pulse */}
          <div ref={collapsibleSectionRef} className="bg-white dark:bg-gray-900/20 backdrop-blur-md rounded-2xl px-6 pb-6">
            <div>
              {/* Section Header */}
              {!isRearrangeMode && (
                <div className="py-4">
                  {/* Row 1: Title + Timeframe Selector + Info button */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 text-lg font-semibold">
                      <Activity className="w-5 h-5 text-green-500" />
                      Market Pulse
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Timeframe Selector */}
                      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        {(['D', 'W', 'M', 'Y'] as const).map((tf) => {
                          const tfMap = { D: 'day', W: 'week', M: 'month', Y: 'year' } as const;
                          const isSelected = selectedTimeframe === tfMap[tf];
                          return (
                            <button
                              key={tf}
                              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                                isSelected
                                  ? 'bg-blue-500 text-white shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                              }`}
                              onClick={() => {
                                const newTimeframe = tfMap[tf];
                                if (newTimeframe !== selectedTimeframe) {
                                  setTimeframeSwitching(true);
                                  setSelectedTimeframe(newTimeframe);
                                  setTimeout(() => setTimeframeSwitching(false), 500);
                                }
                              }}
                            >
                              {tf}
                            </button>
                          );
                        })}
                      </div>
                      {!loading && !error && (
                        <button
                          type="button"
                          className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                          title="Learn more about Market Overview"
                          aria-label="More info about Market Overview"
                          onClick={() => setIsMarketPulseInfoOpen(true)}
                        >
                          <Info className="w-5 h-5 text-gray-400" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Row 2: Top Indicators */}
                  <div className="flex items-center">
                    {/* Top Market Indicators - skeleton when loading, data when loaded */}
                    {loading ? (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                          <div className="w-10 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                          <div className="w-12 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                        </span>
                        <span className="flex items-center gap-1">
                          <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                          <div className="w-10 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                          <div className="w-12 h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                        </span>
                      </div>
                    ) : (topIndicators.bullish || topIndicators.bearish) ? (
                      <div className="flex items-center gap-3 text-xs">
                        {topIndicators.bullish && (
                          <button
                            type="button"
                            onClick={() => {
                              const itemData = marketData[topIndicators.bullish!.symbol];
                              const tfData = itemData?.timeframes?.day;
                              setSelectedStock({
                                symbol: topIndicators.bullish!.symbol,
                                name: topIndicators.bullish!.ticker,
                                price: tfData?.latest?.close ?? itemData?.price ?? 0,
                                change: topIndicators.bullish!.change,
                                valueChange: tfData?.latest?.value_change ?? itemData?.valueChange ?? 0,
                                sparkline: tfData?.closes ?? itemData?.sparkline ?? [],
                                timeframe: 'day',
                                timeframes: itemData?.timeframes,
                              });
                            }}
                            className="flex items-center gap-1 text-green-500 hover:text-green-600 hover:underline transition-colors"
                          >
                            <TrendingUp className="w-3 h-3" />
                            <span className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">{topIndicators.bullish.ticker}</span>
                            <span className="font-semibold">+{topIndicators.bullish.change.toFixed(2)}%</span>
                          </button>
                        )}
                        {topIndicators.bearish && (
                          <button
                            type="button"
                            onClick={() => {
                              const itemData = marketData[topIndicators.bearish!.symbol];
                              const tfData = itemData?.timeframes?.day;
                              setSelectedStock({
                                symbol: topIndicators.bearish!.symbol,
                                name: topIndicators.bearish!.ticker,
                                price: tfData?.latest?.close ?? itemData?.price ?? 0,
                                change: topIndicators.bearish!.change,
                                valueChange: tfData?.latest?.value_change ?? itemData?.valueChange ?? 0,
                                sparkline: tfData?.closes ?? itemData?.sparkline ?? [],
                                timeframe: 'day',
                                timeframes: itemData?.timeframes,
                              });
                            }}
                            className="flex items-center gap-1 text-red-500 hover:text-red-600 hover:underline transition-colors"
                          >
                            <TrendingDown className="w-3 h-3" />
                            <span className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">{topIndicators.bearish.ticker}</span>
                            <span className="font-semibold">{topIndicators.bearish.change.toFixed(2)}%</span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              {/* Toggle between slider and list view for Market Pulse items */}
              {error && loading && (
                <div className='flex justify-between items-center'>
                  <div className='lg:h-16 items-center justify-start pt-1 mr-4'>
                    <p className='text-[#999] mb-2'>Quick look at key market indicators</p>
                  </div>
                </div>
              )}
              <div data-testid="market-pulse-container" className="relative flex flex-col gap-6">
                {!mounted || loading || timeframeSwitching || showReorderSkeleton ? (
                  // Show loading skeletons for all expected tickers
                  <>
                    {/* Show connecting message when retrying */}
                    {retryCount > 0 && (
                      <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        <span>Connecting to market data server... (attempt {retryCount}/10)</span>
                      </div>
                    )}
                    {assetClassOrder.map((classKey) => {
                      const classData = assetClasses[classKey];
                      return (
                        <div key={`skeleton-group-${classKey}`} className="space-y-3">
                          <AssetClassHeaderSkeleton />
                          {classData.tickers.map((ticker) => (
                            <div key={`skeleton-${ticker}`} className="flex-shrink-0 w-full">
                              <PulseSkeleton />
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </>
                ) : error ? (
                  // Show error state with retry option
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="w-12 h-12 text-gray-400 mb-4">
                      <svg className="animate-spin" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Unable to Load Market Data</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">{error}</p>

                    <button
                      onClick={handleRefresh}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                      disabled={loading}
                    >
                      {loading ? 'Retrying...' : 'Try Again'}
                    </button>
                  </div>
                ) : isRearrangeMode ? (
                  // Rearrange mode: show draggable list of asset classes
                  <div className="space-y-3 transition-all duration-300 ease-in-out">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Drag to Reorder Asset Classes</h3>
                    {assetClassOrder.map((classKey, index) => {
                      const classData = assetClasses[classKey];
                      const items = groupedPulse[classKey] || [];
                      const itemCount = items.length;

                      return (
                        <div
                          key={classKey}
                          data-draggable-item
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          onTouchStart={(e) => handleTouchStart(e, index)}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={handleTouchEnd}
                          className={`flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-lg border border-gray-200 dark:border-gray-700 cursor-move hover:shadow-md transition-all duration-200 ease-in-out touch-none select-none transform ${
                            draggedIndex === index ? 'opacity-50 scale-95 shadow-lg rotate-1' : ''
                          } ${draggedIndex !== null && draggedIndex !== index ? 'hover:border-blue-300 dark:hover:border-blue-600 hover:scale-105' : ''}`}
                        >
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-lg">{classData.icon}</span>
                            <span className="font-medium text-gray-900 dark:text-white">{classData.name}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">({itemCount} items)</span>
                          </div>
                          <div className="text-gray-400 mr-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16M4 12h16" />
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                    <div className="mt-6 flex justify-center">
                      <button
                        onClick={() => {
                          // Save the current order to localStorage
                          localStorage.setItem('assetClassOrder', JSON.stringify(assetClassOrder));
                          
                          // Show skeleton transition for 500ms
                          setShowReorderSkeleton(true);
                          setIsRearrangeMode(false);
                          
                          setTimeout(() => {
                            setShowReorderSkeleton(false);
                          }, 500);
                        }}
                        className="px-6 py-2 bg-green-500 text-white font-medium rounded-md hover:bg-green-600 transition-colors"
                      >
                        Done Reordering
                      </button>
                    </div>
                  </div>
                ) : (
                  // Normal mode: show grouped data by asset class
                  assetClassOrder.map((classKey) => {
                    const classData = assetClasses[classKey];
                    const items = groupedPulse[classKey] || [];

                    // Skip hidden asset classes
                    if (hiddenAssetClasses.has(classKey)) return null;

                    // Only show sections that have items
                    if (items.length === 0) return null;

                    return (
                      <div key={classKey} className="space-y-1">
                        {/* Asset Class Dropdown Header */}
                        <button
                          onClick={() => toggleAssetClassExpanded(classKey)}
                          className="w-full flex items-center justify-between gap-2 py-3 px-3 -mx-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{classData.icon}</span>
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                              {classData.name}
                            </h3>
                            <span className="text-xs text-gray-400 dark:text-gray-500 font-normal normal-case">
                              ({items.length})
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {expandedAssetClasses.has(classKey) && items.length > 1 && (
                              <span className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">Long-press to drag</span>
                            )}
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expandedAssetClasses.has(classKey) ? 'rotate-180' : ''}`} />
                          </div>
                        </button>
                        {/* Collapsible Content */}
                        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${expandedAssetClasses.has(classKey) ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                          <div className="space-y-3 pt-2">
                        {items.map((pulse, index) => {
                          const pulseSymbol = (pulse as any).symbol ?? (pulse as any).ticker ?? '—';
                          const pulseName = (pulse as any).ticker ?? (pulse as any).name ?? (pulse as any).index ?? '—';
                          const isPulseDragging = pulseDragState?.classKey === classKey && pulseDragState?.fromIndex === index;
                          const isPulseDragOver = pulseDragState?.classKey === classKey && pulseDragState?.overIndex === index && pulseDragState?.fromIndex !== index;
                          return (
                          <div key={`${classKey}-${pulseSymbol}`} className="flex-shrink-0 w-full">
                            <WatchListItem
                              name={pulseName}
                              symbol={pulseSymbol}
                              price={(pulse as any).price ?? (typeof (pulse as any).value === 'number' ? (pulse as any).value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String((pulse as any).value))}
                              change={typeof (pulse as any).change === 'string' ? parseFloat(((pulse as any).change as string).replace('%', '')) : (pulse as any).change}
                              valueChange={(pulse as any).valueChange}
                              sparkline={(pulse as any).sparkline ?? (pulse as any).trend}
                              timeframe={(pulse as any).timeframe}
                              afterHours={(pulse as any).afterHours}
                              rv={(pulse as any).rv}
                              isInWatchlist={isInWatchlist(pulseSymbol)}
                              isInSwingScreens={isFavorite(pulseSymbol)}
                              isPaperTrading={isPaperTradingEnabled && hasPosition(pulseSymbol)}
                              isRecentlyAdded={recentlyAdded.has(pulseSymbol)}
                              isRecentlyAddedToScreens={recentlyAddedToScreens.has(pulseSymbol)}
                              compactMode={compactMode}
                              showSparkline={showSparklines}
                              showAfterHoursIndicator={showAfterHours}
                              showRelativeVolume={showRelativeVolume}
                              priceChangeFormat={priceChangeFormat}
                              showQuickActions
                              enableDrag={items.length > 1}
                              dragIndex={index}
                              isDragging={isPulseDragging}
                              isDragOver={isPulseDragOver}
                              onDragStart={() => {
                                const newState = { classKey, fromIndex: index, overIndex: null };
                                setPulseDragState(newState);
                                pulseDragStateRef.current = newState;
                              }}
                              onDragEnd={() => {
                                const state = pulseDragStateRef.current;
                                if (state && state.overIndex !== null && state.fromIndex !== state.overIndex) {
                                  reorderPulseItems(state.classKey, state.fromIndex, state.overIndex);
                                }
                                setPulseDragState(null);
                                pulseDragStateRef.current = null;
                              }}
                              onDragOver={() => {
                                if (pulseDragStateRef.current && pulseDragStateRef.current.classKey === classKey) {
                                  const newState = { ...pulseDragStateRef.current, overIndex: index };
                                  setPulseDragState(newState);
                                  pulseDragStateRef.current = newState;
                                }
                              }}
                              onDrop={() => {
                                const state = pulseDragStateRef.current;
                                if (state && state.classKey === classKey && state.fromIndex !== index) {
                                  reorderPulseItems(state.classKey, state.fromIndex, index);
                                }
                                setPulseDragState(null);
                                pulseDragStateRef.current = null;
                              }}
                              onTouchDrag={(touchY) => handlePulseTouchDrag(classKey, touchY)}
                              onLongPress={(position) => setQuickActionMenu({
                                isOpen: true,
                                symbol: pulseSymbol,
                                name: pulseName,
                                position,
                              })}
                              onDoubleTap={() => {
                                // Tiered system: first add to watchlist, then can add to My Screens
                                if (!isInWatchlist(pulseSymbol)) {
                                  const added = addToWatchlist({ symbol: pulseSymbol, name: pulseName });
                                  if (added) {
                                    triggerAddedPulse(pulseSymbol);
                                    showToast(`${pulseSymbol} added to Watchlist`, 'success', 2000, { link: '/watchlist?section=my-watchlist' });
                                  } else {
                                    showToast(`Watchlist full (${MAX_WATCHLIST}/${MAX_WATCHLIST})`, 'warning', 3000, { link: '/watchlist?section=my-watchlist' });
                                  }
                                } else {
                                  // Already in watchlist, toggle My Screens
                                  const wasInScreens = isFavorite(pulseSymbol);
                                  toggleFavorite({ symbol: pulseSymbol, name: pulseName });
                                  if (wasInScreens) {
                                    showToast(`${pulseSymbol} removed from My Screens`, 'info', 5000, { 
                                      link: '/watchlist?section=my-screens',
                                      onUndo: () => addFavorite({ symbol: pulseSymbol, name: pulseName })
                                    });
                                  } else if (favorites.length < MAX_FAVORITES) {
                                    triggerAddedPulsePurple(pulseSymbol);
                                    showToast(`${pulseSymbol} added to My Screens`, 'success', 2000, { link: '/watchlist?section=my-screens' });
                                  } else {
                                    showToast(`My Screens full (${MAX_FAVORITES}/${MAX_FAVORITES})`, 'warning', 3000, { link: '/watchlist?section=my-screens' });
                                  }
                                }
                              }}
                              onClick={() => setSelectedStock({
                                symbol: pulseSymbol,
                                name: pulseName,
                                price: typeof (pulse as any).price === 'number' ? (pulse as any).price : parseFloat(String((pulse as any).price).replace(/,/g, '')),
                                change: typeof (pulse as any).change === 'string' ? parseFloat(((pulse as any).change as string).replace('%', '')) : (pulse as any).change,
                                valueChange: (pulse as any).valueChange ?? 0,
                                sparkline: (pulse as any).sparkline ?? (pulse as any).trend ?? [],
                                timeframe: (pulse as any).timeframe ?? '',
                                timeframes: marketData[pulseSymbol]?.timeframes,
                              })}
                            />
                          </div>
                          );
                        })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
              </div>
              {/* End Tab 0: Market Pulse */}

              {/* Tab 1: Live Screens */}
              <div className="w-full flex-shrink-0 px-6 sm:px-10 pt-2 pb-8">
          
          {/* Live Screens - hidden during rearrange mode */}
          {!isRearrangeMode && (
          <div id="live-screens" className="bg-white dark:bg-gray-900/20 backdrop-blur-md rounded-2xl px-6 pb-6">
            <div>
              {/* Section Header */}
              <div className="flex items-center justify-between py-4">
                <span className="flex items-center gap-2 text-lg font-semibold">
                  <Zap className="w-5 h-5 text-cyan-500" />
                  <span>Live Screens</span>
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 rounded-full">
                    4 Daily
                  </span>
                </span>
                <button
                  type="button"
                  className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  title="Learn more about Live Screens"
                  aria-label="More info about Live Screens"
                  onClick={() => setIsLiveScreensInfoOpen(true)}
                >
                  <Info className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                AI-curated daily stock screens. Double-tap stocks to add to Watchlist.
              </p>
              <LiveScreensContainer
                onStockClick={(stock: LiveScreenStock) => setSelectedStock({
                  symbol: stock.symbol,
                  name: stock.name,
                  price: stock.price,
                  change: stock.change,
                  valueChange: stock.valueChange,
                  sparkline: stock.sparkline,
                  timeframe: stock.timeframe,
                })}
                onStockLongPress={(stock: LiveScreenStock, position: { x: number; y: number }) => setQuickActionMenu({
                  isOpen: true,
                  symbol: stock.symbol,
                  name: stock.name,
                  position,
                })}
                onStockDoubleTap={(stock: LiveScreenStock) => {
                  // Tiered system: first add to watchlist, then can add to My Screens
                  if (!isInWatchlist(stock.symbol)) {
                    const added = addToWatchlist({ symbol: stock.symbol, name: stock.name });
                    if (added) {
                      triggerAddedPulse(stock.symbol);
                      showToast(`${stock.symbol} added to Watchlist`, 'success', 2000, { link: '/watchlist?section=my-watchlist' });
                    } else {
                      showToast(`Watchlist full (${MAX_WATCHLIST}/${MAX_WATCHLIST})`, 'warning', 3000, { link: '/watchlist?section=my-watchlist' });
                    }
                  } else {
                    // Already in watchlist, toggle My Screens
                    const wasInScreens = isFavorite(stock.symbol);
                    toggleFavorite({ symbol: stock.symbol, name: stock.name });
                    if (wasInScreens) {
                      showToast(`${stock.symbol} removed from My Screens`, 'info', 5000, { 
                        link: '/watchlist?section=my-screens',
                        onUndo: () => addFavorite({ symbol: stock.symbol, name: stock.name })
                      });
                    } else if (favorites.length < MAX_FAVORITES) {
                      triggerAddedPulsePurple(stock.symbol);
                      showToast(`${stock.symbol} added to My Screens`, 'success', 2000, { link: '/watchlist?section=my-screens' });
                    } else {
                      showToast(`My Screens full (${MAX_FAVORITES}/${MAX_FAVORITES})`, 'warning', 3000, { link: '/watchlist?section=my-screens' });
                    }
                  }
                }}
                onSaveScreen={(screen: LiveScreenType) => {
                  // Save all stocks from the screen to My Screens
                  let addedCount = 0;
                  let alreadyInWatchlist = 0;
                  
                  for (const stock of screen.stocks) {
                    // First ensure it's in watchlist
                    if (!isInWatchlist(stock.symbol)) {
                      const added = addToWatchlist({ symbol: stock.symbol, name: stock.name });
                      if (!added) continue; // Watchlist full
                    } else {
                      alreadyInWatchlist++;
                    }
                    
                    // Then add to My Screens if not already there
                    if (!isFavorite(stock.symbol) && favorites.length + addedCount < MAX_FAVORITES) {
                      addFavorite({ symbol: stock.symbol, name: stock.name });
                      addedCount++;
                    }
                  }
                  
                  if (addedCount > 0) {
                    showToast(`Added ${addedCount} stocks from "${screen.title}" to My Screens`, 'success', 3000, { link: '/watchlist?section=my-screens' });
                  } else if (alreadyInWatchlist === screen.stocks.length) {
                    showToast('All stocks already in your lists', 'info', 2000);
                  } else {
                    showToast('My Screens is full', 'warning', 2000);
                  }
                }}
                onSaveAllStocks={(stocks: LiveScreenStock[]) => {
                  // Similar to onSaveScreen but for arbitrary stocks
                  let addedCount = 0;
                  for (const stock of stocks) {
                    if (!isInWatchlist(stock.symbol)) {
                      addToWatchlist({ symbol: stock.symbol, name: stock.name });
                    }
                    if (!isFavorite(stock.symbol) && favorites.length + addedCount < MAX_FAVORITES) {
                      addFavorite({ symbol: stock.symbol, name: stock.name });
                      addedCount++;
                    }
                  }
                  if (addedCount > 0) {
                    showToast(`Added ${addedCount} stocks to My Screens`, 'success', 2000);
                  }
                }}
                isInWatchlist={isInWatchlist}
                isFavorite={isFavorite}
                recentlyAdded={recentlyAdded}
                recentlyAddedToScreens={recentlyAddedToScreens}
                selectedScreenIds={selectedScreenIds}
                screens={liveScreensData}
                loading={liveScreensLoading}
                warmingUp={liveScreensWarmingUp}
                error={liveScreensError}
                onRefresh={refreshLiveScreens}
              />
            </div>
          </div>
          )}
              </div>
              {/* End Tab 1: Live Screens */}

              {/* Tab 2: My Watchlist */}
              <div className="w-full flex-shrink-0 px-6 sm:px-10 pt-2 pb-8">

          {/* My Watchlist - hidden during rearrange mode */}
          {!isRearrangeMode && (
          <div id="my-watchlist" className="bg-white dark:bg-gray-900/20 backdrop-blur-md rounded-2xl px-6 pb-6">
            <div>
              {/* Section Header - hidden when error */}
              {!error && (
                <>
                  <div className="flex items-center justify-between py-4">
                    <span className="flex items-center gap-2 text-lg font-semibold">
                      <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                      My Watchlist
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">({watchlist.length}/{MAX_WATCHLIST})</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Timeframe Selector */}
                      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        {(['D', 'W', 'M', 'Y'] as const).map((tf) => {
                          const tfMap = { D: 'day', W: 'week', M: 'month', Y: 'year' } as const;
                          const isSelected = selectedTimeframe === tfMap[tf];
                          return (
                            <button
                              key={tf}
                              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                                isSelected
                                  ? 'bg-blue-500 text-white shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                              }`}
                              onClick={() => {
                                const newTimeframe = tfMap[tf];
                                if (newTimeframe !== selectedTimeframe) {
                                  setTimeframeSwitching(true);
                                  setSelectedTimeframe(newTimeframe);
                                  setTimeout(() => setTimeframeSwitching(false), 500);
                                }
                              }}
                            >
                              {tf}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                        title="Learn more about My Watchlist"
                        aria-label="More info about My Watchlist"
                        onClick={() => setIsMyWatchlistInfoOpen(true)}
                      >
                        <Info className="w-5 h-5 text-gray-400" />
                      </button>
                    </div>
                  </div>
                  {/* Caption explaining limit */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Track up to {MAX_WATCHLIST} assets. Double-tap to add to My Screens
                    <TrendingUp className="w-3.5 h-3.5 ml-1 inline text-purple-500" />
                  </p>
                </>
              )}
              {/* Error state for My Watchlist */}
              {error ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30">
                  <div className="w-12 h-12 text-red-400 mb-4 flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Unable to Load Market Data</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">{error}</p>
                  {retryCount > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      <span className="inline-flex items-center gap-2">
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        Retrying... (attempt {retryCount}/10)
                      </span>
                    </p>
                  )}
                  <button
                    onClick={handleRefresh}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    disabled={loading}
                  >
                    {loading ? (
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
              ) : watchlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
                  <Star className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                    Your watchlist is empty
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-1 mb-4">
                    Add stocks to track their performance
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      onClick={() => setIsSearchOpen(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Search className="w-4 h-4" />
                      Search Stocks
                    </button>
                    <button
                      onClick={() => {
                        setActiveSection('marketPulse');
                        setTimeout(() => document.getElementById('market-pulse')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
                    >
                      <Activity className="w-4 h-4" />
                      Browse Market Pulse
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Interaction hints */}
                  {watchlist.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                      {doubleTapAction === 'screens' && 'Double-tap to add to My Screens'}
                      {doubleTapAction === 'detail' && 'Double-tap to view details'}
                      {doubleTapAction === 'trade' && 'Double-tap to quick trade'}
                      {autoSortWatchlist === 'manual' && watchlist.length > 1 ? ' • Long-press to drag' : ''}
                    </p>
                  )}
                  {sortedWatchlist.map((item, index) => {
                    const itemData = marketData[item.symbol];
                    const timeframeKey = selectedTimeframe as 'day' | 'week' | 'month' | 'year';
                    const tfData = itemData?.timeframes?.[timeframeKey];
                    
                    // Debug: Log data for each watchlist item
                    console.log(`[WATCHLIST DEBUG] ${item.symbol}:`, {
                      hasItemData: !!itemData,
                      hasTfData: !!tfData,
                      timeframeKey,
                      itemDataKeys: itemData ? Object.keys(itemData) : [],
                      tfDataKeys: tfData ? Object.keys(tfData) : [],
                      price: tfData?.latest?.close ?? itemData?.price,
                      change: tfData?.latest?.change ?? itemData?.change,
                      sparklineLength: (tfData?.closes ?? itemData?.sparkline ?? []).length,
                      rawItemData: itemData,
                    });
                    
                    return (
                      <div key={`watchlist-${item.symbol}-${index}`} className="flex-shrink-0 w-full">
                        <WatchListItem
                          name={item.name}
                          symbol={item.symbol}
                          price={tfData?.latest?.close ?? itemData?.price ?? '—'}
                          change={tfData?.latest?.change ?? itemData?.change ?? 0}
                          valueChange={tfData?.latest?.value_change ?? itemData?.valueChange ?? 0}
                          sparkline={tfData?.closes ?? itemData?.sparkline ?? []}
                          timeframe={selectedTimeframe}
                          afterHours={tfData?.latest?.is_after_hours}
                          isInSwingScreens={isFavorite(item.symbol)}
                          isPaperTrading={isPaperTradingEnabled && hasPosition(item.symbol)}
                          isRecentlyAdded={recentlyAdded.has(item.symbol)}
                          isRecentlyAddedToScreens={recentlyAddedToScreens.has(item.symbol)}
                          compactMode={compactMode}
                          showSparkline={showSparklines}
                          showAfterHoursIndicator={showAfterHours}
                          showRelativeVolume={showRelativeVolume}
                          priceChangeFormat={priceChangeFormat}
                          showQuickActions
                          enableSwipe={swipeToDeleteEnabled}
                          enableDrag={autoSortWatchlist === 'manual' && watchlist.length > 1}
                          dragIndex={index}
                          isDragging={watchlistDragIndex === index}
                          isDragOver={watchlistDragOverIndex === index && watchlistDragIndex !== index}
                          onDragStart={() => {
                            console.log('[PAGE] onDragStart, setting dragIndex to:', index);
                            setWatchlistDragIndex(index);
                            watchlistDragIndexRef.current = index;
                          }}
                          onDragEnd={() => {
                            const fromIdx = watchlistDragIndexRef.current;
                            const toIdx = watchlistDragOverIndexRef.current;
                            console.log('[PAGE] onDragEnd, dragIndex:', fromIdx, 'overIndex:', toIdx);
                            if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
                              console.log('[PAGE] Calling reorderWatchlist');
                              reorderWatchlist(fromIdx, toIdx);
                            }
                            setWatchlistDragIndex(null);
                            setWatchlistDragOverIndex(null);
                            watchlistDragIndexRef.current = null;
                            watchlistDragOverIndexRef.current = null;
                          }}
                          onDragOver={() => setWatchlistDragOverIndex(index)}
                          onDrop={() => {
                            if (watchlistDragIndex !== null && watchlistDragIndex !== index) {
                              reorderWatchlist(watchlistDragIndex, index);
                            }
                            setWatchlistDragIndex(null);
                            setWatchlistDragOverIndex(null);
                          }}
                          onTouchDrag={handleWatchlistTouchDrag}
                          onSwipeRemove={() => {
                            const wasInScreens = isFavorite(item.symbol);
                            
                            // Check if this is the last item - show confirmation (if enabled)
                            if (watchlist.length === 1 && confirmLastItemRemoval) {
                              setLastItemRemoveConfirm({
                                isOpen: true,
                                symbol: item.symbol,
                                name: item.name,
                                listType: 'watchlist',
                                wasInScreens,
                              });
                              return;
                            }
                            
                            // Also remove from My Screens if applicable
                            if (wasInScreens) {
                              toggleFavorite({ symbol: item.symbol, name: item.name });
                            }
                            removeFromWatchlist(item.symbol);
                            showToast(`${item.symbol} removed from Watchlist`, 'info', 5000, { 
                              link: '/watchlist?section=my-watchlist',
                              onUndo: () => {
                                addToWatchlist({ symbol: item.symbol, name: item.name });
                                if (wasInScreens) addFavorite({ symbol: item.symbol, name: item.name });
                              }
                            });
                          }}
                          onLongPress={(position) => setQuickActionMenu({
                            isOpen: true,
                            symbol: item.symbol,
                            name: item.name,
                            position,
                          })}
                          onDoubleTap={() => {
                            // Handle double-tap based on user's setting
                            if (doubleTapAction === 'screens') {
                              // Original behavior: toggle My Screens
                              const wasInScreens = isFavorite(item.symbol);
                              toggleFavorite({ symbol: item.symbol, name: item.name });
                              if (wasInScreens) {
                                showToast(`${item.symbol} removed from My Screens`, 'info', 5000, { 
                                  link: '/watchlist?section=my-screens',
                                  onUndo: () => addFavorite({ symbol: item.symbol, name: item.name })
                                });
                              } else if (favorites.length < MAX_FAVORITES) {
                                triggerAddedPulsePurple(item.symbol);
                                showToast(`${item.symbol} added to My Screens`, 'success', 2000, { link: '/watchlist?section=my-screens' });
                              } else {
                                showToast(`My Screens full (${MAX_FAVORITES}/${MAX_FAVORITES})`, 'warning', 3000, { link: '/watchlist?section=my-screens' });
                              }
                            } else if (doubleTapAction === 'detail') {
                              // Open stock detail modal
                              setSelectedStock({
                                symbol: item.symbol,
                                name: item.name,
                                price: typeof tfData?.latest?.close === 'string' 
                                  ? parseFloat(tfData.latest.close.replace(/,/g, '')) 
                                  : (itemData?.price ?? 0),
                                change: tfData?.latest?.change ?? itemData?.change ?? 0,
                                valueChange: tfData?.latest?.value_change ?? itemData?.valueChange ?? 0,
                                sparkline: tfData?.closes ?? itemData?.sparkline ?? [],
                                timeframe: selectedTimeframe,
                                timeframes: itemData?.timeframes,
                              });
                            } else if (doubleTapAction === 'trade') {
                              // Open quick action menu for trading
                              setQuickActionMenu({
                                isOpen: true,
                                symbol: item.symbol,
                                name: item.name,
                                position: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
                              });
                            }
                          }}
                          onClick={() => setSelectedStock({
                            symbol: item.symbol,
                            name: item.name,
                            price: typeof tfData?.latest?.close === 'string' 
                              ? parseFloat(tfData.latest.close.replace(/,/g, '')) 
                              : (itemData?.price ?? 0),
                            change: tfData?.latest?.change ?? itemData?.change ?? 0,
                            valueChange: tfData?.latest?.value_change ?? itemData?.valueChange ?? 0,
                            sparkline: tfData?.closes ?? itemData?.sparkline ?? [],
                            timeframe: selectedTimeframe,
                            timeframes: itemData?.timeframes,
                          })}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}
              </div>
              {/* End Tab 2: My Watchlist */}

              {/* Tab 3: My Screens */}
              <div className="w-full flex-shrink-0 px-6 sm:px-10 pt-2 pb-8">

                {/* My Screens - hidden during rearrange mode */}
                {!isRearrangeMode && (
                  <div id="my-screens" className="bg-white dark:bg-gray-900/20 backdrop-blur-md rounded-2xl px-6 pb-6">
                    <div>
                      {/* Section Header - hidden when error */}
                      {!error && (
                        <>
                          <div className="flex items-center justify-between py-4">
                            <span className="flex items-center gap-2 text-lg font-semibold">
                      <TrendingUp className="w-5 h-5 text-purple-500" />
                      <span>My Screens</span>
                      {favorites.length > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full">
                          {favorites.length}/{MAX_FAVORITES}
                        </span>
                      )}
                            </span>
                            <button
                              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                              title="Learn more about My Screens"
                              aria-label="More info about My Screens"
                              onClick={() => setIsMyScreensInfoOpen(true)}
                            >
                              <Info className="w-5 h-5 text-gray-400" />
                            </button>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            Your top {MAX_FAVORITES} watchlist picks for advanced screening. Double-tap watchlist items to promote here.
                          </p>
                        </>
                      )}

                      {/* Error state for My Screens */}
                      {error ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30">
                  <div className="w-12 h-12 text-red-400 mb-4 flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Unable to Load Market Data</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-md">{error}</p>
                  {retryCount > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      <span className="inline-flex items-center gap-2">
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        Retrying... (attempt {retryCount}/10)
                      </span>
                    </p>
                  )}
                  <button
                    onClick={handleRefresh}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    disabled={loading}
                  >
                    {loading ? (
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
                      ) : favorites.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
                  <TrendingUp className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                    No screens yet
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-1 mb-4">
                    {watchlist.length > 0 
                      ? 'Double-tap watchlist items to add to My Screens'
                      : 'Add items to your watchlist first, then promote them here'
                    }
                  </p>
                  {watchlist.length > 0 ? (
                    <button
                      onClick={() => {
                        setActiveSection('myWatchlist');
                        setTimeout(() => document.getElementById('my-watchlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Star className="w-4 h-4" />
                      Go to Watchlist
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => setIsSearchOpen(true)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        <Search className="w-4 h-4" />
                        Search Stocks
                      </button>
                      <button
                        onClick={() => {
                          setActiveSection('marketPulse');
                          setTimeout(() => document.getElementById('market-pulse')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
                      >
                        <Activity className="w-4 h-4" />
                        Browse Market Pulse
                      </button>
                    </div>
                  )}
                </div>
                      ) : (
                <LiveScreen 
                  favorites={favorites}
                  isInWatchlist={isInWatchlist}
                  enableSwipe={swipeToDeleteEnabled}
                  isActive={activeSection === 'swingScreening'}
                  onSwipeRemove={(symbol, name) => {
                    // Check if this is the last item - show confirmation (if enabled)
                    if (favorites.length === 1 && confirmLastItemRemoval) {
                      setLastItemRemoveConfirm({
                        isOpen: true,
                        symbol,
                        name,
                        listType: 'screens',
                      });
                      return;
                    }
                    
                    removeFavorite(symbol);
                    showToast(`${symbol} removed from My Screens`, 'info', 5000, { 
                      link: '/watchlist?section=my-screens',
                      onUndo: () => addFavorite({ symbol, name })
                    });
                  }}
                  onLongPress={(symbol, name, position) => setQuickActionMenu({
                    isOpen: true,
                    symbol,
                    name,
                    position,
                  })}
                  onDoubleTap={(symbol, name) => {
                    // Double-tap removes from My Screens
                    removeFavorite(symbol);
                    showToast(`${symbol} removed from My Screens`, 'info', 5000, { 
                      link: '/watchlist?section=my-screens',
                      onUndo: () => addFavorite({ symbol, name })
                    });
                  }}
                />
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* End Tab 3: My Screens */}

              {/* Tab 4: Paper Trading */}
              <div className="w-full flex-shrink-0 px-6 sm:px-10 pt-2 pb-8">

          {/* Paper Trading - hidden during rearrange mode */}
          {!isRearrangeMode && (
          <div id="paper-trading" className="bg-white dark:bg-gray-900/20 backdrop-blur-md rounded-2xl px-6 pb-6">
            <div>
              {/* Section Header */}
              <div className="flex items-center justify-between py-4">
                <Link
                  href="/paper-trading"
                  className="flex items-center gap-2 text-lg font-semibold hover:opacity-80 transition-opacity"
                >
                  <FileText className="w-5 h-5 text-orange-500" />
                  <span>Paper Trading</span>
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full">
                    Beta
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </Link>
                <div className="flex items-center gap-3">
                  {/* Toggle Switch */}
                  <button
                    type="button"
                    onClick={togglePaperTrading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${
                      isPaperTradingEnabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                    role="switch"
                    aria-checked={isPaperTradingEnabled}
                    aria-label="Toggle Paper Trading"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                        isPaperTradingEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    title="Learn more about Paper Trading"
                    aria-label="More info about Paper Trading"
                    onClick={() => setIsPaperTradingInfoOpen(true)}
                  >
                    <Info className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Practice trading with virtual money. Test your strategies risk-free before committing real capital.
              </p>
              
              {/* Enabled State - Show Account Info */}
              {isPaperTradingEnabled ? (
                <div className="space-y-4">
                  {isPaperTradingLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
                    </div>
                  ) : paperTradingAccount ? (
                    <>
                      {/* Account Summary Cards */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Cash Balance</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">
                            ${parseFloat(paperTradingAccount.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Value</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">
                            ${parseFloat(paperTradingAccount.total_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total P&L</p>
                          <p className={`text-lg font-semibold ${parseFloat(paperTradingAccount.total_pl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {parseFloat(paperTradingAccount.total_pl) >= 0 ? '+' : ''}${parseFloat(paperTradingAccount.total_pl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Return</p>
                          <p className={`text-lg font-semibold ${parseFloat(paperTradingAccount.total_pl_percent) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {parseFloat(paperTradingAccount.total_pl_percent) >= 0 ? '+' : ''}{parseFloat(paperTradingAccount.total_pl_percent).toFixed(2)}%
                          </p>
                        </div>
                      </div>

                      {/* Current Positions */}
                      <div className="mt-4">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Current Positions</h4>
                        {paperTradingPositions.length === 0 ? (
                          <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                            <p className="text-sm text-gray-500 dark:text-gray-400">No open positions</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Buy stocks from their detail page to open positions</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {paperTradingPositions.map((position) => {
                              const plValue = parseFloat(position.unrealized_pl);
                              const plPercent = parseFloat(position.unrealized_pl_percent);
                              const isPositive = plValue >= 0;
                              return (
                                <button
                                  key={position.symbol}
                                  onClick={() => setSelectedStock({
                                    symbol: position.symbol,
                                    name: position.name,
                                    price: parseFloat(position.current_price),
                                    change: plPercent,
                                    valueChange: plValue,
                                    sparkline: [],
                                    timeframe: selectedTimeframe,
                                  })}
                                  className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-900 dark:text-white">{position.symbol}</span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{position.name}</span>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                      {parseFloat(position.quantity).toLocaleString()} shares @ ${parseFloat(position.average_cost).toFixed(2)}
                                    </div>
                                  </div>
                                  <div className="text-right ml-3">
                                    <div className="font-medium text-gray-900 dark:text-white">
                                      ${parseFloat(position.market_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                    <div className={`text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                      {isPositive ? '+' : ''}{plPercent.toFixed(2)}% ({isPositive ? '+' : ''}${plValue.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Options Positions */}
                      <div className="mt-4">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                          Options Positions
                          {paperTradingOptionPositions.length > 0 && (
                            <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">
                              {paperTradingOptionPositions.length}
                            </span>
                          )}
                        </h4>
                        {paperTradingOptionPositions.length === 0 ? (
                          <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                            <p className="text-sm text-gray-500 dark:text-gray-400">No options positions</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Trade options from the Options Chain on stock detail pages</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {paperTradingOptionPositions.map((position) => {
                              const plValue = parseFloat(position.unrealized_pl);
                              const plPercent = parseFloat(position.unrealized_pl_percent);
                              const isPositive = plValue >= 0;
                              const isCall = position.contract.option_type === 'call';
                              const expDate = new Date(position.contract.expiration_date);
                              const daysToExp = position.contract.days_to_expiration;
                              
                              return (
                                <button
                                  key={position.id}
                                  onClick={() => setSelectedStock({
                                    symbol: position.contract.underlying_symbol,
                                    name: `${position.contract.underlying_symbol} Options`,
                                    price: parseFloat(position.current_price),
                                    change: plPercent,
                                    valueChange: plValue,
                                    sparkline: [],
                                    timeframe: selectedTimeframe,
                                  })}
                                  className={`w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left ${
                                    isCall 
                                      ? 'bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30'
                                      : 'bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-900 dark:text-white">
                                        {position.contract.underlying_symbol} ${parseFloat(position.contract.strike_price).toFixed(0)}{isCall ? 'C' : 'P'}
                                      </span>
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                                        isCall 
                                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                          : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                      }`}>
                                        {isCall ? 'CALL' : 'PUT'}
                                      </span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {position.position_type === 'long' ? 'Long' : 'Short'}
                                      </span>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
                                      <span>{position.quantity}x @ ${parseFloat(position.average_cost).toFixed(2)}</span>
                                      <span className={daysToExp <= 7 ? 'text-orange-500' : ''}>
                                        Exp: {expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ({daysToExp}d)
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-right ml-3">
                                    <div className="font-medium text-gray-900 dark:text-white">
                                      ${parseFloat(position.market_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                    <div className={`text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                      {isPositive ? '+' : ''}{plPercent.toFixed(2)}% ({isPositive ? '+' : ''}${plValue.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      {/* Reset Account Section */}
                      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Reset Account</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Start fresh with a new balance</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5 mb-3 flex-wrap">
                          {[
                            { value: 1000, label: '$1K' },
                            { value: 10000, label: '$10K' },
                            { value: 100000, label: '$100K' },
                            { value: 500000, label: '$500K' },
                            { value: 1000000, label: '$1M' },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setStartingCashBalance(option.value);
                                localStorage.setItem('paperTradingStartingBalance', String(option.value));
                              }}
                              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                startingCashBalance === option.value
                                  ? 'bg-orange-500 text-white border-orange-500'
                                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowResetAccountModal(true)}
                          className="w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                        >
                          Reset to ${startingCashBalance.toLocaleString()}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      <p>Unable to load account. Please try again.</p>
                    </div>
                  )}
                </div>
              ) : (
                /* Disabled State - Show Empty State */
                <div className="flex flex-col items-center justify-center py-12 px-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
                  <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Enable Paper Trading
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-sm mb-4">
                    Toggle the switch above to start paper trading with virtual funds.
                  </p>
                  
                  {/* Starting Balance Selector */}
                  <div className="w-full max-w-xs mb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">Starting Balance</p>
                    <div className="flex gap-1.5 justify-center flex-wrap">
                      {[
                        { value: 1000, label: '$1K' },
                        { value: 10000, label: '$10K' },
                        { value: 100000, label: '$100K' },
                        { value: 500000, label: '$500K' },
                        { value: 1000000, label: '$1M' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setStartingCashBalance(option.value);
                            localStorage.setItem('paperTradingStartingBalance', String(option.value));
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                            startingCashBalance === option.value
                              ? 'bg-orange-500 text-white border-orange-500'
                              : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="w-2 h-2 bg-orange-500 rounded-full" />
                      <span>Risk-free practice trading</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
              </div>
              {/* End Tab 4: Paper Trading */}

            </div>
          </div>
          {/* End Swipeable Tab Content Container */}

        </div>
      </div>

      {/* Floating Button */}
      <>
        <div className="fixed bottom-28 right-4 z-50">
          <button 
            className="bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 transition-colors"
            onClick={() => setIsDrawerOpen(true)}
          >
            <Settings className="w-5 h-5 text-white" />
          </button>
        </div>
      {/* Bottom Drawer */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[99] transition-opacity ${isDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsDrawerOpen(false)}
      >
        <div
          className={`fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-gray-800/20 backdrop-blur-lg shadow-lg z-[100] transform transition-transform max-h-[80vh] flex flex-col ${isDrawerOpen ? 'translate-y-0' : 'translate-y-full'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header - fixed */}
          <div className="flex-shrink-0 flex justify-between items-center p-4 border-b">
            <LineChart className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-lg font-semibold">Manage Watchlist</h2>
            <button 
              onClick={() => setIsDrawerOpen(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {/* Market Pulse Settings - Only show when on Market Pulse tab */}
            {activeTab === 0 && (
              <>
              <button
                className={`text-lg flex items-center justify-between w-full text-left transition-opacity ${!section2Expanded && (displaySettingsExpanded || dataSettingsExpanded) ? 'opacity-40' : ''}`}
                onClick={() => {
                  setSection2Expanded(!section2Expanded);
                  setSection3Expanded(false);
                  setDisplaySettingsExpanded(false);
                  setDataSettingsExpanded(false);
                  setWatchlistSettingsExpanded(false);
                }}
              >
                <h3 className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-500" />
                  Market Pulse
                </h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${section2Expanded ? 'rotate-180' : ''}`} />
              </button>
              {section2Expanded && (
                <div className="mt-3 space-y-4">
                  {/* Arrange Asset Classes */}
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Drag and drop to reorder asset class sections.
                    </p>
                    <button
                      onClick={() => {
                        setIsRearrangeMode(!isRearrangeMode);
                        setIsDrawerOpen(false);
                      }}
                      className="px-4 py-2 bg-blue-500 text-white text-sm rounded-md hover:bg-blue-600 transition-colors"
                    >
                      {isRearrangeMode ? 'Exit Re-arrange' : 'Re-arrange Asset Classes'}
                    </button>
                  </div>
                  
                  {/* Show/Hide Asset Classes */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Show/Hide Asset Classes</p>
                    <div className="space-y-2">
                      {Object.entries(assetClasses).map(([key, classData]) => {
                        const isHidden = hiddenAssetClasses.has(key);
                        return (
                          <label key={key} className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!isHidden}
                              onChange={() => {
                                setHiddenAssetClasses(prev => {
                                  const next = new Set(prev);
                                  if (isHidden) {
                                    next.delete(key);
                                  } else {
                                    next.add(key);
                                  }
                                  localStorage.setItem('marketPulseHiddenClasses', JSON.stringify([...next]));
                                  return next;
                                });
                              }}
                              className="w-4 h-4 rounded border-gray-300 text-green-500 focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                              <span>{classData.icon}</span>
                              {classData.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Collapsed by Default */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Collapsed by Default</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Start with all asset classes collapsed</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={assetClassesCollapsedByDefault}
                        onClick={() => {
                          const newValue = !assetClassesCollapsedByDefault;
                          setAssetClassesCollapsedByDefault(newValue);
                          localStorage.setItem('marketPulseCollapsedByDefault', String(newValue));
                          // Apply immediately
                          if (newValue) {
                            setExpandedAssetClasses(new Set());
                          } else {
                            const keys = Object.keys(assetClasses);
                            setExpandedAssetClasses(new Set(keys.length > 0 ? [keys[0]] : []));
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${assetClassesCollapsedByDefault ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${assetClassesCollapsedByDefault ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </label>
                  </div>
                  
                  {/* Show Top Indicators in Header */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Top Indicators in Header</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Show best/worst performers in the header</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={showTopIndicatorsInHeader}
                        onClick={() => {
                          const newValue = !showTopIndicatorsInHeader;
                          setShowTopIndicatorsInHeader(newValue);
                          localStorage.setItem('marketPulseShowTopIndicators', String(newValue));
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showTopIndicatorsInHeader ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showTopIndicatorsInHeader ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </label>
                  </div>
                </div>
              )}
              </>
            )}

            {/* Paper Trading Settings - Only show when on Paper Trading tab */}
            {activeTab === 4 && (
              <>
              <button
                className={`text-lg flex items-center justify-between w-full text-left transition-opacity ${!paperTradingSettingsExpanded && (displaySettingsExpanded || dataSettingsExpanded) ? 'opacity-40' : ''}`}
                onClick={() => {
                  setPaperTradingSettingsExpanded(!paperTradingSettingsExpanded);
                  setDisplaySettingsExpanded(false);
                  setDataSettingsExpanded(false);
                }}
              >
                <h3 className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-amber-500" />
                  Paper Trading
                </h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${paperTradingSettingsExpanded ? 'rotate-180' : ''}`} />
              </button>
              {paperTradingSettingsExpanded && (
                <div className="mt-3 space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Configure your paper trading preferences.
                  </p>
                  
                  {/* Show P/L as */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Show P/L as</p>
                    <div className="flex gap-2">
                      {[
                        { value: '$', label: '$' },
                        { value: '%', label: '%' },
                        { value: 'both', label: 'Both' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setPlDisplayFormat(option.value as '$' | '%' | 'both');
                            localStorage.setItem('paperTradingPlFormat', option.value);
                          }}
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                            plDisplayFormat === option.value
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Default Order Type */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Default Order Type</p>
                    <div className="flex gap-2">
                      {[
                        { value: 'market', label: 'Market' },
                        { value: 'limit', label: 'Limit' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setDefaultOrderType(option.value as 'market' | 'limit');
                            localStorage.setItem('paperTradingOrderType', option.value);
                          }}
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                            defaultOrderType === option.value
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Confirm Before Trades */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm Before Trades</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Show confirmation dialog before executing</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={confirmBeforeTrades}
                        onClick={() => {
                          const newValue = !confirmBeforeTrades;
                          setConfirmBeforeTrades(newValue);
                          localStorage.setItem('paperTradingConfirmTrades', String(newValue));
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${confirmBeforeTrades ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${confirmBeforeTrades ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </label>
                  </div>
                  
                  {/* Starting Cash Balance */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Starting Cash Balance</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Balance when resetting account ($1K - $10M)</p>
                    <div className="flex gap-2">
                      {[
                        { value: 1000, label: '$1K' },
                        { value: 10000, label: '$10K' },
                        { value: 100000, label: '$100K' },
                        { value: 500000, label: '$500K' },
                        { value: 1000000, label: '$1M' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setStartingCashBalance(option.value);
                            localStorage.setItem('paperTradingStartingBalance', String(option.value));
                          }}
                          className={`flex-1 px-2 py-2 text-xs rounded-lg border transition-colors ${
                            startingCashBalance === option.value
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2">
                      <input
                        type="number"
                        min="1000"
                        max="10000000"
                        step="1000"
                        value={startingCashBalance}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 1000 && val <= 10000000) {
                            setStartingCashBalance(val);
                            localStorage.setItem('paperTradingStartingBalance', String(val));
                          }
                        }}
                        className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Custom amount..."
                      />
                    </div>
                  </div>
                  
                  {/* Reset Account */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Reset Account</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Clear all positions and reset to ${startingCashBalance.toLocaleString()}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDrawerOpen(false); // Close drawer first
                        setShowResetAccountModal(true);
                      }}
                      className="w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                      Reset Paper Trading Account
                    </button>
                  </div>
                </div>
              )}
              </>
            )}

            {/* Live Screen Categories - Only show when on Live Screens tab */}
            {activeTab === 1 && (
              <>
              <button
                className={`text-lg flex items-center justify-between w-full text-left transition-opacity ${!section3Expanded && (displaySettingsExpanded || dataSettingsExpanded) ? 'opacity-40' : ''}`}
                onClick={() => {
                  setSection3Expanded(!section3Expanded);
                  setDisplaySettingsExpanded(false);
                  setDataSettingsExpanded(false);
                }}
              >
                <h3 className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-500" />
                  Live Screens
                </h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${section3Expanded ? 'rotate-180' : ''}`} />
              </button>
              {section3Expanded && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Choose which screens to display.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {allScreenIds.map((screenId) => {
                      const screen = screenTemplates[screenId];
                      const isSelected = selectedScreenIds.includes(screenId);
                      // Explicit border color mapping for each screen
                      const borderColors: Record<string, string> = {
                        green: 'border-l-green-500',
                        purple: 'border-l-purple-500',
                        red: 'border-l-red-500',
                        cyan: 'border-l-cyan-500',
                        blue: 'border-l-blue-500',
                        orange: 'border-l-orange-500',
                        yellow: 'border-l-yellow-500',
                      };
                      const checkboxBorderColors: Record<string, string> = {
                        green: 'border-green-500',
                        purple: 'border-purple-500',
                        red: 'border-red-500',
                        cyan: 'border-cyan-500',
                        blue: 'border-blue-500',
                        orange: 'border-orange-500',
                        yellow: 'border-yellow-500',
                      };
                      const textColors: Record<string, string> = {
                        green: 'text-green-500',
                        purple: 'text-purple-500',
                        red: 'text-red-500',
                        cyan: 'text-cyan-500',
                        blue: 'text-blue-500',
                        orange: 'text-orange-500',
                        yellow: 'text-yellow-500',
                      };
                      return (
                        <button
                          key={screenId}
                          onClick={() => {
                            const newScreens = isSelected
                              ? selectedScreenIds.filter(s => s !== screenId)
                              : [...selectedScreenIds, screenId];
                            // Ensure at least one screen is selected
                            if (newScreens.length > 0) {
                              setSelectedScreenIds(newScreens as ScreenId[]);
                              localStorage.setItem('selectedScreenIds', JSON.stringify(newScreens));
                            }
                          }}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-l-4 transition-all ${borderColors[screen.color]} ${
                            isSelected 
                              ? 'bg-white dark:bg-gray-700 border border-l-4 border-gray-200 dark:border-gray-600 shadow-sm' 
                              : 'bg-gray-50 dark:bg-gray-800/50 border border-l-4 border-gray-100 dark:border-gray-700/50 opacity-60'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                            isSelected 
                              ? `${checkboxBorderColors[screen.color]} bg-white dark:bg-gray-800` 
                              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                          }`}>
                            {isSelected && (
                              <svg className={`w-3 h-3 ${textColors[screen.color]}`} fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <span className="text-base">{screen.icon}</span>
                          <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                            {screen.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {selectedScreenIds.length} of {allScreenIds.length} screens selected
                  </p>
                </div>
              )}
              </>
            )}

            {/* Watchlist Settings - Only show when on My Watchlist or My Screens tabs */}
            {(activeTab === 2 || activeTab === 3) && (
              <button
                className={`text-lg flex items-center justify-between w-full text-left transition-opacity ${!watchlistSettingsExpanded && (displaySettingsExpanded || dataSettingsExpanded) ? 'opacity-40' : ''}`}
                onClick={() => {
                  setWatchlistSettingsExpanded(!watchlistSettingsExpanded);
                  setDisplaySettingsExpanded(false);
                  setDataSettingsExpanded(false);
                }}
              >
                <h3 className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500" />
                  {activeTab === 3 ? 'My Screens Settings' : 'Watchlist Settings'}
                </h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${watchlistSettingsExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
            {(activeTab === 2 || activeTab === 3) && watchlistSettingsExpanded && (
              <div className="mt-3 space-y-4">
                {/* Double-Tap Action */}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Double-Tap Action</p>
                  <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                    {([
                      { value: 'screens', label: 'My Screens' },
                      { value: 'detail', label: 'Detail' },
                      { value: 'trade', label: 'Trade' },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => {
                          setDoubleTapAction(value);
                          localStorage.setItem('watchlistDoubleTapAction', value);
                        }}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                          doubleTapAction === value
                            ? 'bg-yellow-500 text-white'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {{
                      screens: 'Double-tap adds/removes from My Screens',
                      detail: 'Double-tap opens stock detail modal',
                      trade: 'Double-tap opens quick trade panel',
                    }[doubleTapAction]}
                  </p>
                </div>

                {/* Swipe-to-Delete */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Swipe-to-Delete</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Swipe left to remove items</p>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !swipeToDeleteEnabled;
                      setSwipeToDeleteEnabled(newValue);
                      localStorage.setItem('watchlistSwipeToDelete', String(newValue));
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      swipeToDeleteEnabled ? 'bg-yellow-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                      swipeToDeleteEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {/* Confirm Before Removing Last Item */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Confirm Last Item Removal</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Ask before removing the last item</p>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !confirmLastItemRemoval;
                      setConfirmLastItemRemoval(newValue);
                      localStorage.setItem('watchlistConfirmLastItem', String(newValue));
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      confirmLastItemRemoval ? 'bg-yellow-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                      confirmLastItemRemoval ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {/* Auto-sort - only for My Watchlist */}
                {activeTab === 2 && (
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Auto-sort Watchlist</p>
                    <div className="grid grid-cols-2 gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                      {([
                        { value: 'manual', label: 'Manual' },
                        { value: 'change', label: 'By Change %' },
                        { value: 'name', label: 'By Name' },
                        { value: 'recent', label: 'Recently Added' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setAutoSortWatchlist(value);
                            localStorage.setItem('watchlistAutoSort', value);
                          }}
                          className={`px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                            autoSortWatchlist === value
                              ? 'bg-yellow-500 text-white'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {{
                        manual: 'Drag to reorder manually',
                        change: 'Sorted by price change % (highest first)',
                        name: 'Sorted alphabetically by symbol',
                        recent: 'Most recently added first',
                      }[autoSortWatchlist]}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Display Settings - Always show */}
            <button
              className={`text-lg mt-4 flex items-center justify-between w-full text-left transition-opacity ${!displaySettingsExpanded && dataSettingsExpanded ? 'opacity-40' : ''}`}
              onClick={() => {
                setDisplaySettingsExpanded(!displaySettingsExpanded);
                setDataSettingsExpanded(false);
                // Close tab-specific sections
                setSection2Expanded(false);
                setSection3Expanded(false);
                setPaperTradingSettingsExpanded(false);
                setWatchlistSettingsExpanded(false);
              }}
            >
                <h3 className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-blue-500" />
                  Display Settings
                </h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${displaySettingsExpanded ? 'rotate-180' : ''}`} />
              </button>
              {displaySettingsExpanded && (
                <div className="mt-3 space-y-4">
                  {/* Compact Mode */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Compact Mode</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Smaller cards, more items visible</p>
                    </div>
                    <button
                      onClick={() => {
                        const newValue = !compactMode;
                        setCompactMode(newValue);
                        localStorage.setItem('watchlistCompactMode', String(newValue));
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        compactMode ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                        compactMode ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* Show Sparklines */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Show Sparklines</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Display mini price charts</p>
                    </div>
                    <button
                      onClick={() => {
                        const newValue = !showSparklines;
                        setShowSparklines(newValue);
                        localStorage.setItem('watchlistShowSparklines', String(newValue));
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showSparklines ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                        showSparklines ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* Show After-Hours Indicator */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">After-Hours Indicator</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Show extended hours badge</p>
                    </div>
                    <button
                      onClick={() => {
                        const newValue = !showAfterHours;
                        setShowAfterHours(newValue);
                        localStorage.setItem('watchlistShowAfterHours', String(newValue));
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showAfterHours ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                        showAfterHours ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* Show Relative Volume */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Relative Volume (RV)</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Show volume vs average</p>
                    </div>
                    <button
                      onClick={() => {
                        const newValue = !showRelativeVolume;
                        setShowRelativeVolume(newValue);
                        localStorage.setItem('watchlistShowRV', String(newValue));
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showRelativeVolume ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                        showRelativeVolume ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* Price Change Format */}
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Price Change Format</p>
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                      {([
                        { value: 'percent', label: '%' },
                        { value: 'dollar', label: '$' },
                        { value: 'both', label: 'Both' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setPriceChangeFormat(value);
                            localStorage.setItem('watchlistPriceChangeFormat', value);
                          }}
                          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                            priceChangeFormat === value
                              ? 'bg-blue-500 text-white'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {priceChangeFormat === 'percent' && 'Show percentage change only (+2.5%)'}
                      {priceChangeFormat === 'dollar' && 'Show dollar change only (+$5.00)'}
                      {priceChangeFormat === 'both' && 'Show both (+$5.00, +2.5%)'}
                    </p>
                  </div>
                </div>
              )}

            {/* Data Settings - Always show */}
            <button
              className={`text-lg mt-4 flex items-center justify-between w-full text-left transition-opacity ${!dataSettingsExpanded && displaySettingsExpanded ? 'opacity-40' : ''}`}
              onClick={() => {
                setDataSettingsExpanded(!dataSettingsExpanded);
                setDisplaySettingsExpanded(false);
                // Close tab-specific sections
                setSection2Expanded(false);
                setSection3Expanded(false);
                setPaperTradingSettingsExpanded(false);
                setWatchlistSettingsExpanded(false);
              }}
            >
                <h3 className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-green-500" />
                  Data Settings
                </h3>
                <ChevronDown className={`w-5 h-5 transition-transform ${dataSettingsExpanded ? 'rotate-180' : ''}`} />
              </button>
              {dataSettingsExpanded && (
                <div className="mt-3 space-y-4">
                  {/* Auto-Refresh Interval */}
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Auto-Refresh Interval</p>
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                      {([
                        { value: 15, label: '15s' },
                        { value: 30, label: '30s' },
                        { value: 60, label: '60s' },
                        { value: 0, label: 'Manual' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setAutoRefreshInterval(value);
                            localStorage.setItem('watchlistAutoRefreshInterval', String(value));
                          }}
                          className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                            autoRefreshInterval === value
                              ? 'bg-green-500 text-white'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {autoRefreshInterval === 0 
                        ? 'Data updates only when you manually refresh' 
                        : `Data auto-updates every ${autoRefreshInterval} seconds`}
                    </p>
                  </div>

                  {/* Default Timeframe */}
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Default Timeframe</p>
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                      {([
                        { value: 'day', label: 'D' },
                        { value: 'week', label: 'W' },
                        { value: 'month', label: 'M' },
                        { value: 'year', label: 'Y' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => {
                            setDefaultTimeframe(value);
                            localStorage.setItem('watchlistDefaultTimeframe', value);
                            // Also update current timeframe if user changes default
                            setSelectedTimeframe(value);
                          }}
                          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                            defaultTimeframe === value
                              ? 'bg-green-500 text-white'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {{
                        day: 'Daily price data (1D)',
                        week: 'Weekly price data (1W)',
                        month: 'Monthly price data (1M)',
                        year: 'Yearly price data (1Y)',
                      }[defaultTimeframe]}
                    </p>
                  </div>

                  {/* Show Extended Hours Data */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Extended Hours Data</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Include pre/after-market prices</p>
                    </div>
                    <button
                      onClick={() => {
                        const newValue = !showExtendedHoursData;
                        setShowExtendedHoursData(newValue);
                        localStorage.setItem('watchlistShowExtendedHoursData', String(newValue));
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showExtendedHoursData ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${
                        showExtendedHoursData ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* Manual Refresh Button (visible when auto-refresh is off) */}
                  {autoRefreshInterval === 0 && (
                    <button
                      onClick={handleRefresh}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-medium rounded-lg transition-colors"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                      {loading ? 'Refreshing...' : 'Refresh Data Now'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Close button of Bottom Drawer */}
            <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="px-4 w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Close
              </button>
            </div>
        </div>
      </div>
      </>

      {/* Search Drawer */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[99] transition-opacity ${isSearchOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => {
          setIsSearchOpen(false);
          setSearchQuery('');
          setSearchResults([]);
        }}
      >
        <div
          className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 shadow-lg z-[100] transform transition-transform h-[65vh] lg:max-h-[85vh] lg:h-auto rounded-t-3xl flex flex-col ${isSearchOpen ? 'translate-y-0' : 'translate-y-full'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle bar */}
          <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
          </div>

          {/* Search Header */}
          <div className="px-4 pb-4 flex-shrink-0">
            <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-3">
              <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search stocks, ETFs, crypto..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    searchInputRef.current?.focus();
                  }}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Search Results */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {searchLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
                {searchResults.map((result) => {
                  const isResultInWatchlist = isInWatchlist(result.symbol);
                  const isResultFavorite = isFavorite(result.symbol);
                  
                  return (
                    <div
                      key={result.symbol}
                      className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      {/* Main clickable area */}
                      <button
                        onClick={() => {
                          const existingData = marketData[result.symbol];
                          const timeframeKey = selectedTimeframe as 'day' | 'week' | 'month' | 'year';
                          const tfData = existingData?.timeframes?.[timeframeKey];
                          
                          setSelectedStock({
                            symbol: result.symbol,
                            name: result.name,
                            price: tfData?.latest?.close 
                              ? parseFloat(String(tfData.latest.close).replace(/,/g, '')) 
                              : (existingData?.price ?? 0),
                            change: tfData?.latest?.change ?? existingData?.change ?? 0,
                            valueChange: tfData?.latest?.value_change ?? existingData?.valueChange ?? 0,
                            sparkline: tfData?.closes ?? existingData?.sparkline ?? [],
                            timeframe: selectedTimeframe,
                            timeframes: existingData?.timeframes,
                          });
                          
                          setIsSearchOpen(false);
                          setSearchQuery('');
                          setSearchResults([]);
                        }}
                        className="flex flex-col items-start flex-1 text-left"
                      >
                        <span className="font-semibold text-gray-900 dark:text-white">{result.symbol}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{result.name}</span>
                      </button>

                      {/* Quick action buttons */}
                      <div className="flex items-center gap-1 ml-2">
                        {/* Watchlist toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isResultInWatchlist) {
                              // Store if was in My Screens before removal
                              const wasInScreens = isFavorite(result.symbol);
                              if (wasInScreens) removeFavorite(result.symbol);
                              removeFromWatchlist(result.symbol);
                              showToast(`${result.symbol} removed from Watchlist`, 'info', 5000, { 
                                link: '/watchlist?section=my-watchlist', 
                                onClick: () => {
                                  setIsSearchOpen(false);
                                  setActiveSection('myWatchlist');
                                  setTimeout(() => document.getElementById('my-watchlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                },
                                onUndo: () => {
                                  addToWatchlist({ symbol: result.symbol, name: result.name });
                                  if (wasInScreens) addFavorite({ symbol: result.symbol, name: result.name });
                                }
                              });
                            } else {
                              const added = addToWatchlist({ symbol: result.symbol, name: result.name });
                              if (added) {
                                triggerAddedPulse(result.symbol);
                                showToast(`${result.symbol} added to Watchlist`, 'success', 2000, { link: '/watchlist?section=my-watchlist', onClick: () => {
                                  setIsSearchOpen(false);
                                  setActiveSection('myWatchlist');
                                  setTimeout(() => document.getElementById('my-watchlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                } });
                              } else {
                                showToast(`Watchlist full (${MAX_WATCHLIST}/${MAX_WATCHLIST})`, 'warning', 3000, { link: '/watchlist?section=my-watchlist', onClick: () => {
                                  setIsSearchOpen(false);
                                  setActiveSection('myWatchlist');
                                  setTimeout(() => document.getElementById('my-watchlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                } });
                              }
                            }
                          }}
                          className={`p-2 rounded-full transition-all ${
                            isResultInWatchlist
                              ? 'bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-800/40'
                              : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                          title={isResultInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        >
                          <Star
                            className={`w-4 h-4 transition-colors ${
                              isResultInWatchlist
                                ? 'text-yellow-500 fill-yellow-500'
                                : 'text-gray-400 hover:text-yellow-500'
                            }`}
                          />
                        </button>

                        {/* My Screens toggle (tiered - must be in watchlist first) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isResultFavorite) {
                              removeFavorite(result.symbol);
                              showToast(`${result.symbol} removed from My Screens`, 'info', 5000, { 
                                link: '/watchlist?section=my-screens', 
                                onClick: () => {
                                  setIsSearchOpen(false);
                                  setActiveSection('swingScreening');
                                  setTimeout(() => document.getElementById('my-screens')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                },
                                onUndo: () => addFavorite({ symbol: result.symbol, name: result.name })
                              });
                            } else if (!isResultInWatchlist) {
                              showToast(`Add ${result.symbol} to Watchlist first`, 'warning', 2000, { link: '/watchlist?section=my-watchlist', onClick: () => {
                                setIsSearchOpen(false);
                                setActiveSection('myWatchlist');
                                setTimeout(() => document.getElementById('my-watchlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                              } });
                            } else {
                              const added = addFavorite({ symbol: result.symbol, name: result.name });
                              if (added) {
                                showToast(`${result.symbol} added to My Screens`, 'success', 2000, { link: '/watchlist?section=my-screens', onClick: () => {
                                  setIsSearchOpen(false);
                                  setActiveSection('swingScreening');
                                  setTimeout(() => document.getElementById('my-screens')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                } });
                              } else {
                                showToast(`My Screens full (${MAX_FAVORITES}/${MAX_FAVORITES})`, 'warning', 3000, { link: '/watchlist?section=my-screens', onClick: () => {
                                  setIsSearchOpen(false);
                                  setActiveSection('swingScreening');
                                  setTimeout(() => document.getElementById('my-screens')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                } });
                              }
                            }
                          }}
                          className={`p-2 rounded-full transition-all ${
                            isResultFavorite
                              ? 'bg-purple-100 dark:bg-purple-900/30 hover:bg-purple-200 dark:hover:bg-purple-800/40'
                              : !isResultInWatchlist
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                          title={isResultFavorite ? 'Remove from My Screens' : !isResultInWatchlist ? 'Add to Watchlist first' : 'Add to My Screens'}
                        >
                          <TrendingUp
                            className={`w-4 h-4 transition-colors ${
                              isResultFavorite
                                ? 'text-purple-500'
                                : !isResultInWatchlist
                                  ? 'text-gray-300'
                                  : 'text-gray-400 hover:text-purple-500'
                            }`}
                          />
                        </button>
                      </div>

                      {result.type && (
                        <span className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full ml-2">
                          {result.type}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : searchQuery.length > 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No results found for "{searchQuery}"</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try a different search term</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Popular Searches</p>
                <div className="flex flex-wrap gap-2">
                  {['AAPL', 'TSLA', 'NVDA', 'SPY', 'BTC-USD', 'GOOGL'].map((symbol) => (
                    <button
                      key={symbol}
                      onClick={() => handleSearchChange(symbol)}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Close Button */}
          <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => {
                setIsSearchOpen(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Stock Preview Modal */}
      <StockPreviewModal
        isOpen={selectedStock !== null}
        onClose={() => setSelectedStock(null)}
        symbol={selectedStock?.symbol || ''}
        name={selectedStock?.name || ''}
        price={selectedStock?.price || 0}
        change={selectedStock?.change || 0}
        valueChange={selectedStock?.valueChange || 0}
        sparkline={selectedStock?.sparkline || []}
        timeframe={selectedStock?.timeframe || ''}
        timeframes={selectedStock?.timeframes}
      />

      {/* Last Item Removal Confirmation Modal */}
      {lastItemRemoveConfirm?.isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setLastItemRemoveConfirm(null)}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Remove Last Item?
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              <span className="font-medium">{lastItemRemoveConfirm.symbol}</span> is the last item in your {lastItemRemoveConfirm.listType === 'watchlist' ? 'Watchlist' : 'My Screens'}. 
              Removing it will empty the list.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setLastItemRemoveConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { symbol, name, listType, wasInScreens } = lastItemRemoveConfirm;
                  
                  if (listType === 'watchlist') {
                    if (wasInScreens) {
                      toggleFavorite({ symbol, name });
                    }
                    removeFromWatchlist(symbol);
                    showToast(`${symbol} removed from Watchlist`, 'info', 5000, { 
                      link: '/watchlist?section=my-watchlist',
                      onUndo: () => {
                        addToWatchlist({ symbol, name });
                        if (wasInScreens) addFavorite({ symbol, name });
                      }
                    });
                  } else {
                    removeFavorite(symbol);
                    showToast(`${symbol} removed from My Screens`, 'info', 5000, { 
                      link: '/watchlist?section=my-screens',
                      onUndo: () => addFavorite({ symbol, name })
                    });
                  }
                  
                  setLastItemRemoveConfirm(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Market Pulse Info Modal */}
      <InfoModal
        open={isMarketPulseInfoOpen}
        onClose={() => setIsMarketPulseInfoOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-500" />
            About Market Pulse
          </span>
        }
        ariaLabel="Market Pulse Information"
      >
        <div className="space-y-4 text-gray-700 dark:text-gray-300 w-full max-w-md">
          {/* Animated Pulse Line Illustration */}
          <svg className="w-full h-24 mb-2" viewBox="0 0 400 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="pulseGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="50%" stopColor="#eab308" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            {/* Background grid */}
            <g className="opacity-20 dark:opacity-10">
              {[0, 1, 2, 3, 4].map((i) => (
                <line key={`h-${i}`} x1="0" y1={i * 25} x2="400" y2={i * 25} stroke="currentColor" strokeWidth="0.5" />
              ))}
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <line key={`v-${i}`} x1={i * 50} y1="0" x2={i * 50} y2="100" stroke="currentColor" strokeWidth="0.5" />
              ))}
            </g>
            {/* Glow effect (behind main line) */}
            <path
              d="M0 50 L50 50 L70 20 L90 80 L110 35 L130 65 L150 45 L180 30 L210 55 L240 25 L270 60 L300 40 L330 50 L360 35 L400 50"
              stroke="url(#pulseGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-30"
              style={{ filter: 'blur(4px)' }}
            />
            {/* Main pulse line */}
            <path
              d="M0 50 L50 50 L70 20 L90 80 L110 35 L130 65 L150 45 L180 30 L210 55 L240 25 L270 60 L300 40 L330 50 L360 35 L400 50"
              stroke="url(#pulseGradient)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Animated dot traveling along the line */}
            <circle r="5" fill="#22c55e">
              <animateMotion
                dur="3s"
                repeatCount="indefinite"
                path="M0 50 L50 50 L70 20 L90 80 L110 35 L130 65 L150 45 L180 30 L210 55 L240 25 L270 60 L300 40 L330 50 L360 35 L400 50"
              />
            </circle>
          </svg>

          <p>
            <strong>Market Pulse</strong> provides a real-time snapshot of key market indicators across multiple asset classes.
          </p>
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📈 Stock Indexes</h4>
              <p className="text-sm">Track major indices like S&P 500, Dow Jones, Nasdaq, and Russell 2000 to gauge overall market sentiment.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">₿ Cryptocurrency</h4>
              <p className="text-sm">Monitor leading cryptocurrencies including Bitcoin, Ethereum, and more, along with the Crypto Fear & Greed Index.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">⛏️ Precious Metals</h4>
              <p className="text-sm">Follow gold, silver, copper, and other metals that often serve as safe-haven assets.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">⚡ Energy</h4>
              <p className="text-sm">Track crude oil, natural gas, and clean energy ETFs to understand energy market dynamics.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📊 Market Indicators</h4>
              <p className="text-sm">The VIX (Fear Index), Put/Call Ratio, and Treasury yields help assess market risk and investor sentiment.</p>
            </div>
          </div>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <strong>Tip:</strong> Use the D/W/M/Y buttons to switch timeframes, or the settings button to rearrange asset classes.
            </p>
          </div>
        </div>
      </InfoModal>

      {/* My Watchlist Info Modal */}
      <InfoModal
        open={isMyWatchlistInfoOpen}
        onClose={() => setIsMyWatchlistInfoOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
            About My Watchlist
          </span>
        }
        ariaLabel="My Watchlist Information"
      >
        <div className="space-y-4 text-gray-700 dark:text-gray-300 w-full max-w-md">
          {/* Watchlist illustration - Items being added to list */}
          <div className="w-full h-32 mb-2 relative overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800/50">
            <style>{`
              @keyframes scrollItems {
                0% { transform: translateY(120px); }
                100% { transform: translateY(-280px); }
              }
              .watchlist-scroll-items {
                animation: scrollItems 10s linear infinite;
              }
            `}</style>
            <svg className="w-full h-full" viewBox="0 0 400 130" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <clipPath id="listClipWatchlist">
                  <rect x="100" y="5" width="290" height="120" rx="8" />
                </clipPath>
              </defs>
              
              {/* Star icon on left side */}
              <g transform="translate(45, 65)">
                <polygon
                  points="0,-22 6,-8 22,-8 9,3 14,20 0,11 -14,20 -9,3 -22,-8 -6,-8"
                  fill="#eab308"
                  className="animate-pulse"
                />
              </g>
              
              {/* Arrow pointing to list */}
              <path d="M75 65 L95 65" stroke="#eab308" strokeWidth="3" strokeLinecap="round" />
              <polygon points="95,60 105,65 95,70" fill="#eab308" />
              
              {/* List container border */}
              <rect x="100" y="5" width="290" height="120" rx="8" fill="none" stroke="#4b5563" strokeWidth="2" />
              
              {/* Scrolling list items */}
              <g clipPath="url(#listClipWatchlist)">
                <g className="watchlist-scroll-items">
                  {/* Item 1 */}
                  <g transform="translate(110, 20)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">AAPL</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Apple Inc.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+2.4%</text>
                  </g>
                  {/* Item 2 */}
                  <g transform="translate(110, 60)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">TSLA</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Tesla Inc.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#ef4444">-1.2%</text>
                  </g>
                  {/* Item 3 */}
                  <g transform="translate(110, 100)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">NVDA</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">NVIDIA Corp.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+5.1%</text>
                  </g>
                  {/* Item 4 */}
                  <g transform="translate(110, 140)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">BTC</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Bitcoin</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+3.8%</text>
                  </g>
                  {/* Item 5 */}
                  <g transform="translate(110, 180)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">GOOGL</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Alphabet Inc.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+0.9%</text>
                  </g>
                  {/* Item 6 */}
                  <g transform="translate(110, 220)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">AMZN</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Amazon.com</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#ef4444">-0.5%</text>
                  </g>
                  {/* Item 7 */}
                  <g transform="translate(110, 260)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">MSFT</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Microsoft</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+1.7%</text>
                  </g>
                  {/* Duplicate items for seamless loop */}
                  {/* Item 1 repeat */}
                  <g transform="translate(110, 300)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">AAPL</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Apple Inc.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+2.4%</text>
                  </g>
                  {/* Item 2 repeat */}
                  <g transform="translate(110, 340)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">TSLA</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">Tesla Inc.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#ef4444">-1.2%</text>
                  </g>
                  {/* Item 3 repeat */}
                  <g transform="translate(110, 380)">
                    <rect x="0" y="0" width="270" height="32" rx="6" fill="#374151" fillOpacity="0.6" />
                    <polygon points="16,16 18,11 23,11 19,14 20,19 16,17 12,19 13,14 9,11 14,11" fill="#eab308" />
                    <text x="32" y="20" fontSize="12" fontWeight="bold" fill="white">NVDA</text>
                    <text x="80" y="20" fontSize="10" fill="#9ca3af">NVIDIA Corp.</text>
                    <text x="230" y="20" fontSize="11" fontWeight="600" fill="#22c55e">+5.1%</text>
                  </g>
                </g>
              </g>
              
              {/* Fade overlays */}
              <defs>
                <linearGradient id="fadeTopWatchlist" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f3f4f6" stopOpacity="1" />
                  <stop offset="100%" stopColor="#f3f4f6" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="fadeBottomWatchlist" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f3f4f6" stopOpacity="0" />
                  <stop offset="100%" stopColor="#f3f4f6" stopOpacity="1" />
                </linearGradient>
              </defs>
              <rect x="100" y="5" width="290" height="25" fill="url(#fadeTopWatchlist)" className="dark:opacity-80" />
              <rect x="100" y="100" width="290" height="25" fill="url(#fadeBottomWatchlist)" className="dark:opacity-80" />
            </svg>
          </div>

          <p>
            <strong>My Watchlist</strong> is your personal collection of up to {MAX_WATCHLIST} assets you want to track closely.
          </p>
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">⭐ Adding Assets</h4>
              <p className="text-sm">Search for any stock, ETF, or crypto, or tap the star icon on Market Pulse items to add them.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📱 Quick Actions</h4>
              <p className="text-sm"><strong>Double-tap</strong> to promote an asset to My Screens for advanced analysis. <strong>Long-press</strong> for more options.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">↔️ Organize</h4>
              <p className="text-sm"><strong>Long-press and drag</strong> to reorder your watchlist. <strong>Swipe left</strong> to remove an item.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📊 Real-time Data</h4>
              <p className="text-sm">See live prices, percentage changes, and mini sparkline charts for all your tracked assets.</p>
            </div>
          </div>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <strong>Tip:</strong> Items in your watchlist can be promoted to My Screens for swing trade screening and deeper analysis.
            </p>
          </div>
        </div>
      </InfoModal>

      {/* Live Screens Info Modal */}
      <InfoModal
        open={isLiveScreensInfoOpen}
        onClose={() => setIsLiveScreensInfoOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-500" />
            About Live Screens
          </span>
        }
        ariaLabel="Live Screens Information"
      >
        <div className="space-y-4 text-gray-700 dark:text-gray-300 w-full max-w-md">
          {/* Live Screens illustration - Real-time data streaming animation */}
          <div className="w-full h-32 mb-2 relative overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800/50">
            <style>{`
              @keyframes streamData {
                0% { transform: translateX(-100%); opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { transform: translateX(100%); opacity: 0; }
              }
              @keyframes pulse {
                0%, 100% { transform: scale(1); opacity: 0.8; }
                50% { transform: scale(1.2); opacity: 1; }
              }
              @keyframes blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
              }
              .stream-line { animation: streamData 2s ease-in-out infinite; }
              .stream-line-2 { animation: streamData 2s ease-in-out 0.3s infinite; }
              .stream-line-3 { animation: streamData 2s ease-in-out 0.6s infinite; }
              .pulse-dot { animation: pulse 1.5s ease-in-out infinite; }
              .blink-indicator { animation: blink 1s ease-in-out infinite; }
            `}</style>
            <svg className="w-full h-full" viewBox="0 0 400 130" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Background grid */}
              <g className="opacity-10">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <line key={`h-${i}`} x1="0" y1={15 + i * 20} x2="400" y2={15 + i * 20} stroke="#9ca3af" strokeWidth="0.5" />
                ))}
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <line key={`v-${i}`} x1={i * 50} y1="0" x2={i * 50} y2="130" stroke="#9ca3af" strokeWidth="0.5" />
                ))}
              </g>
              
              {/* Live indicator */}
              <g transform="translate(15, 15)">
                <circle cx="6" cy="6" r="6" fill="#ef4444" className="blink-indicator" />
                <circle cx="6" cy="6" r="3" fill="#fff" />
                <text x="18" y="10" fontSize="10" fontWeight="bold" fill="#ef4444">LIVE</text>
              </g>
              
              {/* Central radar/screen element */}
              <g transform="translate(200, 65)">
                <circle cx="0" cy="0" r="40" stroke="#06b6d4" strokeWidth="2" fill="none" className="opacity-30" />
                <circle cx="0" cy="0" r="30" stroke="#06b6d4" strokeWidth="1.5" fill="none" className="opacity-40" />
                <circle cx="0" cy="0" r="20" stroke="#06b6d4" strokeWidth="1" fill="none" className="opacity-50" />
                <circle cx="0" cy="0" r="5" fill="#06b6d4" className="pulse-dot" />
                {/* Radar sweep */}
                <line x1="0" y1="0" x2="35" y2="-20" stroke="#06b6d4" strokeWidth="2" className="opacity-60">
                  <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite" />
                </line>
                {/* Detection dots */}
                <circle cx="25" cy="-15" r="4" fill="#22c55e" className="pulse-dot" style={{ animationDelay: '0.2s' }} />
                <circle cx="-20" cy="25" r="4" fill="#22c55e" className="pulse-dot" style={{ animationDelay: '0.5s' }} />
                <circle cx="30" cy="10" r="4" fill="#eab308" className="pulse-dot" style={{ animationDelay: '0.8s' }} />
              </g>
              
              {/* Streaming data lines - left side */}
              <g className="stream-line">
                <rect x="20" y="40" width="80" height="6" rx="3" fill="#06b6d4" fillOpacity="0.6" />
              </g>
              <g className="stream-line-2">
                <rect x="20" y="60" width="60" height="6" rx="3" fill="#06b6d4" fillOpacity="0.4" />
              </g>
              <g className="stream-line-3">
                <rect x="20" y="80" width="70" height="6" rx="3" fill="#06b6d4" fillOpacity="0.5" />
              </g>
              
              {/* Streaming data lines - right side */}
              <g className="stream-line" style={{ animationDirection: 'reverse' }}>
                <rect x="300" y="40" width="80" height="6" rx="3" fill="#06b6d4" fillOpacity="0.6" />
              </g>
              <g className="stream-line-2" style={{ animationDirection: 'reverse' }}>
                <rect x="310" y="60" width="60" height="6" rx="3" fill="#06b6d4" fillOpacity="0.4" />
              </g>
              <g className="stream-line-3" style={{ animationDirection: 'reverse' }}>
                <rect x="305" y="80" width="70" height="6" rx="3" fill="#06b6d4" fillOpacity="0.5" />
              </g>
              
              {/* Status indicators at bottom */}
              <g transform="translate(80, 105)">
                <rect x="0" y="0" width="50" height="16" rx="4" fill="#22c55e" fillOpacity="0.2" stroke="#22c55e" strokeWidth="1" />
                <circle cx="10" cy="8" r="4" fill="#22c55e" className="blink-indicator" />
                <text x="30" y="12" fontSize="9" fontWeight="bold" fill="#22c55e" textAnchor="middle">SCAN</text>
              </g>
              <g transform="translate(175, 105)">
                <rect x="0" y="0" width="50" height="16" rx="4" fill="#06b6d4" fillOpacity="0.2" stroke="#06b6d4" strokeWidth="1" />
                <circle cx="10" cy="8" r="4" fill="#06b6d4" className="pulse-dot" />
                <text x="30" y="12" fontSize="9" fontWeight="bold" fill="#06b6d4" textAnchor="middle">FEED</text>
              </g>
              <g transform="translate(270, 105)">
                <rect x="0" y="0" width="50" height="16" rx="4" fill="#a855f7" fillOpacity="0.2" stroke="#a855f7" strokeWidth="1" />
                <circle cx="10" cy="8" r="4" fill="#a855f7" className="blink-indicator" style={{ animationDelay: '0.3s' }} />
                <text x="30" y="12" fontSize="9" fontWeight="bold" fill="#a855f7" textAnchor="middle">ALERT</text>
              </g>
            </svg>
          </div>

          <p>
            <strong>Live Screens</strong> are AI-powered market scanners that automatically find trading opportunities based on technical indicators, volume patterns, and market conditions. Updated in real-time during market hours.
          </p>
          
          {/* Screen Descriptions */}
          <div className="space-y-3 mt-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <span>Available Screens</span>
              <span className="text-xs font-normal text-gray-500">(8 screens)</span>
            </h3>
            
            {/* Morning Movers */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border-l-3 border-green-500">
              <span className="text-lg">🚀</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Morning Movers</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Top gaining stocks with above-average volume. Identifies early momentum plays that could continue trending throughout the day.</p>
              </div>
            </div>
            
            {/* Unusual Volume */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border-l-3 border-red-500">
              <span className="text-lg">🔥</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Unusual Volume</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Stocks trading 2x+ their 20-day average volume. High volume often precedes significant price moves and indicates institutional interest.</p>
              </div>
            </div>
            
            {/* Oversold Bounces */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/10 border-l-3 border-cyan-500">
              <span className="text-lg">📉</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Oversold Bounces</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Stocks with RSI below 35 showing reversal signals. These may be ready to bounce back after being oversold.</p>
              </div>
            </div>
            
            {/* Overbought Warning */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border-l-3 border-yellow-500">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Overbought Warning</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Stocks with RSI above 70, potentially due for a pullback. Useful for taking profits or avoiding chasing extended moves.</p>
              </div>
            </div>
            
            {/* Volatility Squeeze */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/10 border-l-3 border-orange-500">
              <span className="text-lg">⚡</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Volatility Squeeze</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Stocks with narrowing Bollinger Bands, indicating low volatility. These often precede explosive breakout moves.</p>
              </div>
            </div>
            
            {/* Breakout Watch */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/10 border-l-3 border-cyan-500">
              <span className="text-lg">📊</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Breakout Watch</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Stocks trading near 52-week highs with momentum. Breaking to new highs often signals continued strength.</p>
              </div>
            </div>
            
            {/* Sector Leaders */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/10 border-l-3 border-purple-500">
              <span className="text-lg">🏭</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Sector Leaders</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Top performing sector ETFs today. Track which sectors are leading the market for rotation strategies.</p>
              </div>
            </div>
            
            {/* Value Plays */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border-l-3 border-blue-500">
              <span className="text-lg">💎</span>
              <div>
                <p className="font-medium text-sm text-gray-800 dark:text-gray-200">Value Plays</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Low P/E stocks with positive momentum. Combines value metrics with technical strength for quality picks.</p>
              </div>
            </div>
          </div>
          
          {/* How to Use */}
          <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800/50 rounded-lg">
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">💡 How to Use</h4>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <li>• <strong>Tap</strong> a stock card to view detailed info</li>
              <li>• <strong>Double-tap</strong> to quickly add to your watchlist</li>
              <li>• <strong>Long-press</strong> for quick actions menu</li>
              <li>• Use <strong>Settings</strong> to show/hide specific screens</li>
            </ul>
          </div>
        </div>
      </InfoModal>

      {/* My Screens Info Modal */}
      <InfoModal
        open={isMyScreensInfoOpen}
        onClose={() => setIsMyScreensInfoOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-500" />
            About My Screens
          </span>
        }
        ariaLabel="My Screens Information"
      >
        <div className="space-y-4 text-gray-700 dark:text-gray-300 w-full max-w-md">
          {/* My Screens illustration - Chart analysis animation */}
          <div className="w-full h-32 mb-2 relative overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800/50">
            <style>{`
              @keyframes analyzeChart {
                0%, 100% { transform: translateX(0); }
                50% { transform: translateX(10px); }
              }
              @keyframes pulseGlow {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 0.8; }
              }
              .analyze-line {
                animation: analyzeChart 2s ease-in-out infinite;
              }
              .glow-effect {
                animation: pulseGlow 2s ease-in-out infinite;
              }
            `}</style>
            <svg className="w-full h-full" viewBox="0 0 400 130" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Background grid */}
              <g className="opacity-20">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <line key={`h-${i}`} x1="30" y1={15 + i * 20} x2="370" y2={15 + i * 20} stroke="#9ca3af" strokeWidth="0.5" />
                ))}
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <line key={`v-${i}`} x1={30 + i * 48.5} y1="15" x2={30 + i * 48.5} y2="115" stroke="#9ca3af" strokeWidth="0.5" />
                ))}
              </g>
              
              {/* Chart line with glow */}
              <path
                d="M30 90 Q80 85 100 70 T150 55 T200 65 T250 40 T300 50 T350 30 L370 25"
                stroke="#a855f7"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                className="glow-effect"
                style={{ filter: 'blur(6px)' }}
              />
              <path
                d="M30 90 Q80 85 100 70 T150 55 T200 65 T250 40 T300 50 T350 30 L370 25"
                stroke="#a855f7"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              
              {/* Analysis scan line */}
              <g className="analyze-line">
                <line x1="200" y1="10" x2="200" y2="120" stroke="#a855f7" strokeWidth="2" strokeDasharray="4 4" className="opacity-60" />
                <circle cx="200" cy="65" r="8" fill="#a855f7" className="opacity-80" />
                <circle cx="200" cy="65" r="4" fill="white" />
              </g>
              
              {/* Trend arrow */}
              <g transform="translate(320, 35)">
                <polygon points="0,15 15,0 30,15 22,15 22,30 8,30 8,15" fill="#22c55e" className="opacity-80" />
              </g>
              
              {/* Data points */}
              {[[100, 70], [150, 55], [250, 40], [350, 30]].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="5" fill="#a855f7" stroke="white" strokeWidth="2" />
              ))}
              
              {/* Mini indicator badges */}
              <g transform="translate(50, 100)">
                <rect x="0" y="0" width="45" height="18" rx="4" fill="#22c55e" fillOpacity="0.2" stroke="#22c55e" strokeWidth="1" />
                <text x="22.5" y="13" fontSize="10" fontWeight="bold" fill="#22c55e" textAnchor="middle">RSI</text>
              </g>
              <g transform="translate(105, 100)">
                <rect x="0" y="0" width="55" height="18" rx="4" fill="#a855f7" fillOpacity="0.2" stroke="#a855f7" strokeWidth="1" />
                <text x="27.5" y="13" fontSize="10" fontWeight="bold" fill="#a855f7" textAnchor="middle">MACD</text>
              </g>
              <g transform="translate(170, 100)">
                <rect x="0" y="0" width="40" height="18" rx="4" fill="#eab308" fillOpacity="0.2" stroke="#eab308" strokeWidth="1" />
                <text x="20" y="13" fontSize="10" fontWeight="bold" fill="#eab308" textAnchor="middle">BB</text>
              </g>
            </svg>
          </div>

          <p>
            <strong>My Screens</strong> is your advanced screening dashboard for up to {MAX_FAVORITES} priority assets from your watchlist.
          </p>
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📈 Swing Trade Analysis</h4>
              <p className="text-sm">Get detailed technical indicators, support/resistance levels, and trend analysis for each screened asset.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">⬆️ Promoting Assets</h4>
              <p className="text-sm"><strong>Double-tap</strong> any watchlist item to promote it to My Screens for deeper analysis.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">🎯 Priority Focus</h4>
              <p className="text-sm">Limited to {MAX_FAVORITES} assets to help you focus on your best trading opportunities.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">🔄 Easy Management</h4>
              <p className="text-sm"><strong>Double-tap</strong> to remove from screens. <strong>Swipe left</strong> for quick removal.</p>
            </div>
          </div>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <strong>Tip:</strong> Use My Screens for assets you're actively considering for trades. Keep your watchlist for broader market monitoring.
            </p>
          </div>
        </div>
      </InfoModal>

      {/* Paper Trading Info Modal */}
      <InfoModal
        open={isPaperTradingInfoOpen}
        onClose={() => setIsPaperTradingInfoOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange-500" />
            About Paper Trading
          </span>
        }
        ariaLabel="Paper Trading Information"
      >
        <div className="space-y-4 text-gray-700 dark:text-gray-300 w-full max-w-md">
          {/* Paper Trading illustration */}
          <div className="w-full h-32 mb-2 relative overflow-hidden rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20">
            <svg className="w-full h-full" viewBox="0 0 400 130" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Background grid */}
              <g className="opacity-10">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <line key={`h-${i}`} x1="0" y1={i * 26} x2="400" y2={i * 26} stroke="currentColor" strokeWidth="0.5" />
                ))}
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <line key={`v-${i}`} x1={i * 50} y1="0" x2={i * 50} y2="130" stroke="currentColor" strokeWidth="0.5" />
                ))}
              </g>
              
              {/* Rising chart line */}
              <path
                d="M20 100 L80 85 L140 90 L200 60 L260 70 L320 40 L380 25"
                stroke="#f97316"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
              
              {/* Area under the line */}
              <path
                d="M20 100 L80 85 L140 90 L200 60 L260 70 L320 40 L380 25 L380 130 L20 130 Z"
                fill="url(#orangeGradient)"
                className="opacity-30"
              />
              
              <defs>
                <linearGradient id="orangeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f97316" />
                  <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                </linearGradient>
              </defs>
              
              {/* Dollar signs */}
              <text x="50" y="50" fill="#22c55e" fontSize="24" fontWeight="bold" className="opacity-60">$</text>
              <text x="180" y="35" fill="#22c55e" fontSize="18" fontWeight="bold" className="opacity-40">$</text>
              <text x="300" y="65" fill="#22c55e" fontSize="20" fontWeight="bold" className="opacity-50">$</text>
              
              {/* Virtual badge */}
              <rect x="290" y="95" width="90" height="24" rx="12" fill="#f97316" className="opacity-90" />
              <text x="335" y="112" fill="white" fontSize="11" fontWeight="600" textAnchor="middle">VIRTUAL</text>
            </svg>
          </div>

          <p>
            <strong>Paper Trading</strong> lets you practice trading with virtual money—no real funds at risk. Perfect for testing strategies before committing real capital.
          </p>
          
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">💰 Virtual Balance</h4>
              <p className="text-sm">Start with $100,000 in virtual funds. Buy and sell stocks just like real trading.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📊 Track Performance</h4>
              <p className="text-sm">Monitor your positions, P&L, and portfolio value in real-time with live market prices.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">📈 Options Trading</h4>
              <p className="text-sm">Practice options strategies including calls, puts, and multi-leg positions.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-1">🔄 Reset Anytime</h4>
              <p className="text-sm">Made some mistakes? Reset your account to start fresh with a new $100,000 balance.</p>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">🚀 How to Paper Trade</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li><strong>Enable Paper Trading</strong> — Toggle the Paper Trading switch ON from your Watchlist or Settings page.</li>
              <li><strong>Search for a Stock</strong> — Use the search bar to find any stock by ticker or company name.</li>
              <li><strong>Open Stock Details</strong> — Tap on a stock to view its detail page with charts and analysis.</li>
              <li><strong>Place a Trade</strong> — In the Paper Trading section, enter the number of shares and click Buy or Sell.</li>
              <li><strong>Track Your Portfolio</strong> — View your holdings, P&L, and performance on the Home page or Paper Trading dashboard.</li>
            </ol>
          </div>
          
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <strong>Tip:</strong> Toggle Paper Trading on to see your account summary and start placing virtual trades from stock detail pages.
            </p>
          </div>
        </div>
      </InfoModal>

      {/* Reset Account Confirmation Modal */}
      {showResetAccountModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowResetAccountModal(false)}>
          <div 
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reset Paper Trading Account?</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This will close all positions and reset your balance to ${startingCashBalance.toLocaleString()}. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowResetAccountModal(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const user = localStorage.getItem('user');
                    const email = user ? JSON.parse(user).email : null;
                    if (!email) {
                      showToast('Please log in to reset account', 'error');
                      setShowResetAccountModal(false);
                      return;
                    }
                    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
                    const response = await fetch(`${backendUrl}/api/paper-trading/account/reset/`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'X-User-Email': email,
                      },
                      body: JSON.stringify({ starting_balance: startingCashBalance }),
                    });
                    if (response.ok) {
                      showToast('Paper trading account reset successfully!', 'success');
                      // Refresh paper trading data from both context and data hook
                      if (refreshAccount) {
                        await refreshAccount();
                      }
                      if (refreshPaperTradingData) {
                        refreshPaperTradingData();
                      }
                    } else {
                      const errData = await response.json();
                      showToast(errData.error || 'Failed to reset account', 'error');
                    }
                  } catch (err) {
                    showToast('Failed to reset account', 'error');
                  }
                  setShowResetAccountModal(false);
                }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
              >
                Reset Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Menu (for long-press/right-click on Market Pulse items) */}
      {quickActionMenu && (
        <QuickActionMenu
          symbol={quickActionMenu.symbol}
          name={quickActionMenu.name}
          isOpen={quickActionMenu.isOpen}
          onClose={() => setQuickActionMenu(null)}
          position={quickActionMenu.position}
          onActionComplete={(action, added, symbol) => {
            const menuName = quickActionMenu.name;
            if (action === 'favorite') {
              if (added) {
                triggerAddedPulsePurple(symbol);
                showToast(`${symbol} added to My Screens`, 'success', 2000, { link: '/watchlist?section=my-screens' });
              } else if (!isFavorite(symbol) && !isInWatchlist(symbol)) {
                // Tried to add but not in watchlist (tiered requirement)
                showToast(`Add ${symbol} to Watchlist first`, 'warning', 2000, { link: '/watchlist?section=my-watchlist' });
              } else if (!added && !isFavorite(symbol)) {
                // It was in My Screens and got removed
                showToast(`${symbol} removed from My Screens`, 'info', 5000, { 
                  link: '/watchlist?section=my-screens',
                  onUndo: () => addFavorite({ symbol, name: menuName })
                });
              }
            } else {
              if (!added) {
                // Removed from watchlist - also may have been removed from My Screens
                const wasInScreens = isFavorite(symbol);
                showToast(
                  `${symbol} removed from Watchlist`,
                  'info',
                  5000,
                  { 
                    link: '/watchlist?section=my-watchlist',
                    onUndo: () => {
                      addToWatchlist({ symbol, name: menuName });
                      // Note: if it was in My Screens, it would have been auto-removed
                    }
                  }
                );
              } else {
                triggerAddedPulse(symbol);
                showToast(`${symbol} added to Watchlist`, 'success', 2000, { link: '/watchlist?section=my-watchlist' });
              }
            }
          }}
        />
      )}
    </div>
  );
}

// Wrapper component with Suspense boundary for useSearchParams
export default function WatchlistPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-pulse text-white">Loading...</div>
      </div>
    }>
      <WatchlistPageContent />
    </Suspense>
  );
}
