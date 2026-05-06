"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';

// Ticker to name mapping for Market Pulse
export const MARKET_PULSE_TICKER_NAMES: Record<string, string> = {
  '^GSPC': 'SP 500',
  '^DJI': 'DOW',
  '^IXIC': 'Nasdaq',
  '^VIX': 'VIX (Fear Index)',
  'DGS10': '10-Yr Yield',
  'BTC-USD': 'Bitcoin',
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'CL=F': 'Crude Oil',
  '^RUT': 'Russell 2000',
  'DGS2': '2-Yr Yield',
  'ETH-USD': 'Ethereum',
  'HG=F': 'Copper',
  'NG=F': 'Natural Gas',
  'CALL/PUT Ratio': 'Put/Call Ratio',
  'SOL-USD': 'Solana',
  'XRP-USD': 'Ripple',
  'CRYPTO-FEAR-GREED': 'Crypto Fear & Greed',
  'LIT': 'Lithium',
  'PL=F': 'Platinum',
  'PA=F': 'Palladium',
  'TAN': 'Solar ETF',
  'ICLN': 'Clean Energy ETF',
  'HYDR': 'Hydrogen ETF'
};

// Asset class groupings
export const MARKET_PULSE_ASSET_CLASSES: Record<string, { name: string; tickers: string[]; icon?: string }> = {
  indexes: {
    name: 'Stock Indexes',
    tickers: ['^GSPC', '^DJI', '^IXIC', '^RUT'],
    icon: '📈'
  },
  crypto: {
    name: 'Cryptocurrency',
    tickers: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'CRYPTO-FEAR-GREED'],
    icon: '₿'
  },
  minerals: {
    name: 'Precious Metals',
    tickers: ['GC=F', 'SI=F', 'HG=F', 'LIT', 'PL=F', 'PA=F'],
    icon: '⛏️'
  },
  energy: {
    name: 'Energy',
    tickers: ['CL=F', 'NG=F', 'TAN', 'ICLN', 'HYDR'],
    icon: '⚡'
  },
  indicators: {
    name: 'Market Indicators',
    tickers: ['^VIX', 'CALL/PUT Ratio', 'DGS10', 'DGS2'],
    icon: '📊'
  }
};

// All Market Pulse tickers
export const MARKET_PULSE_TICKERS = Object.keys(MARKET_PULSE_TICKER_NAMES);

// Types
export interface TimeframeData {
  closes: number[];
  latest: {
    close: string;
    change: number;
    value_change: number;
    is_after_hours: boolean;
  };
}

export interface MarketPulseTickerData {
  timeframes?: {
    day?: TimeframeData;
    week?: TimeframeData;
    month?: TimeframeData;
    year?: TimeframeData;
  };
  // Legacy flat properties for backward compatibility
  price?: string | number;
  change?: number;
  valueChange?: number;
  sparkline?: number[];
  rv?: number | null;
}

export interface MarketPulseData {
  [ticker: string]: MarketPulseTickerData;
}

interface UseMarketPulseDataOptions {
  isActive: boolean;
  pollingInterval?: number; // ms, default 30000 (30s)
}

interface UseMarketPulseDataReturn {
  data: MarketPulseData;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  retryCount: number;
  backendReady: boolean;
  refresh: () => void;
}

const MARKET_PULSE_CACHE_KEY = 'mktpulse_data_v1';

export function useMarketPulseData({ 
  isActive, 
  pollingInterval = 30000 
}: UseMarketPulseDataOptions): UseMarketPulseDataReturn {
  // SSR-safe initial state — useLayoutEffect applies sessionStorage cache synchronously
  // before paint on the client, avoiding hydration mismatches.
  const [data, setData] = useState<MarketPulseData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [backendReady, setBackendReady] = useState(true);
  
  // Refs — hasFetchedRef is updated in useLayoutEffect if cache exists
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasFetchedRef = useRef<boolean>(false);
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);

  // Seed state from sessionStorage synchronously before first paint (client only)
  useLayoutEffect(() => {
    try {
      const cached = sessionStorage.getItem(MARKET_PULSE_CACHE_KEY);
      if (cached) {
        setData(JSON.parse(cached));
        setLoading(false);
        hasFetchedRef.current = true;
      }
    } catch { /* sessionStorage unavailable */ }
  }, []);

  // Health check
  const checkBackendHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/market-data/health/`,
        { signal: AbortSignal.timeout(3000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Main fetch function
  const fetchData = useCallback(async (isInitial = false, isRetry = false) => {
    // Skip in test environment
    if (process.env.NODE_ENV === 'test') return;
    
    // Skip if tab is inactive AND we already have data (use cached)
    if (!isActive && hasFetchedRef.current) return;
    
    // Clear any pending retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    if (isInitial) {
      setLoading(true);
      setError(null);
      if (!isRetry) {
        retryCountRef.current = 0;
        setRetryCount(0);
      }
    }
    
    try {
      // Health check
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        setBackendReady(false);
        throw new Error('Backend server is not available');
      }
      setBackendReady(true);
      
      const tickerParam = MARKET_PULSE_TICKERS.join(',');
      
      // Use longer timeout on initial load vs polling
      const timeoutMs = isRetry ? 30000 : 60000;
      
      const timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      }, timeoutMs);
      
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/market-data/?tickers=${encodeURIComponent(tickerParam)}`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (controller.signal.aborted) return;
      
      if (!res.ok) {
        throw new Error(`Server responded with status: ${res.status}`);
      }
      
      const json = await res.json();
      
      setData(json || {});
      setError(null);
      setLastFetched(Date.now());
      retryCountRef.current = 0;
      setRetryCount(0);
      hasFetchedRef.current = true;
      try { sessionStorage.setItem(MARKET_PULSE_CACHE_KEY, JSON.stringify(json || {})); } catch { /* quota */ }
      
    } catch (err: any) {
      // Check if this was an intentional cancellation
      if (err.name === 'AbortError' && controller !== abortControllerRef.current) {
        return; // Newer request took over
      }
      
      const wasTimeout = err.name === 'AbortError' && controller === abortControllerRef.current;
      
      // Mark backend as not ready on connection errors
      if (err.message?.includes('Failed to fetch') || 
          err.message?.includes('ERR_CONNECTION_REFUSED') || 
          err.message?.includes('not available')) {
        setBackendReady(false);
      }
      
      let errorMessage = wasTimeout 
        ? 'Request timed out. The server is fetching market data. Please wait...'
        : 'Unable to load market data';
      
      if (!wasTimeout) {
        if (err.message?.includes('Failed to fetch') || 
            err.message?.includes('ERR_CONNECTION_REFUSED') || 
            err.message?.includes('not available')) {
          errorMessage = 'Unable to connect to the market data server. Please ensure the backend server is running.';
        } else if (err.message?.includes('Server responded with status')) {
          errorMessage = `Server error: ${err.message}`;
        } else if (err.message) {
          errorMessage = `Network error: ${err.message}`;
        }
      }
      
      setError(errorMessage);
      
      // Auto-retry up to 10 times with exponential backoff (only on initial load)
      if (isInitial && retryCountRef.current < 10 && isMountedRef.current) {
        const delay = Math.min(2000 + (retryCountRef.current * 2000), 15000);
        retryCountRef.current++;
        setRetryCount(retryCountRef.current);
        
        retryTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && isActive) {
            setLoading(true);
            fetchData(true, true);
          }
        }, delay);
      }
    } finally {
      setLoading(false);
    }
  }, [isActive, checkBackendHealth]);

  // Initial fetch when tab becomes active (if no data yet)
  useEffect(() => {
    if (isActive && !hasFetchedRef.current) {
      fetchData(true, false);
    }
  }, [isActive, fetchData]);

  // Polling - only when active and has data
  useEffect(() => {
    // Clear polling when tab is not active
    if (!isActive) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    
    // Don't start polling until we have initial data
    if (!hasFetchedRef.current || Object.keys(data).length === 0) {
      return;
    }
    
    // Start polling when active
    pollingRef.current = setInterval(() => {
      if (isMountedRef.current) {
        fetchData(false, false); // Silent background refresh
      }
    }, pollingInterval);
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isActive, pollingInterval, fetchData, data]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Manual refresh function
  const refresh = useCallback(() => {
    retryCountRef.current = 0;
    setRetryCount(0);
    fetchData(true, false);
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    lastFetched,
    retryCount,
    backendReady,
    refresh,
  };
}
