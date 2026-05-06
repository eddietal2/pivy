# import pandas as pd  # Moved inside functions to avoid circular import issues
# import yfinance as yf  # Moved inside functions to avoid server startup issues
import pytz  # For timezone handling
import os
import sys
import threading
import logging
import locale
import time
import random
from functools import lru_cache
from datetime import datetime, timedelta
from io import StringIO
# from alpha_vantage.timeseries import TimeSeries  # Removed Alpha Vantage as it doesn't support indices intraday

# Suppress yfinance verbose output and warnings
logging.getLogger('yfinance').setLevel(logging.CRITICAL)
logging.getLogger('peewee').setLevel(logging.CRITICAL)

# Set locale for number formatting
try:
    locale.setlocale(locale.LC_ALL, 'en_US.UTF-8')
except:
    try:
        locale.setlocale(locale.LC_ALL, 'en_US')
    except:
        pass  # Use default locale if en_US is not available

# Lock for yfinance calls to prevent concurrent access issues
yf_lock = threading.Lock()

# Rate limit tracking
_last_yf_request = None
_yf_request_count = 0
_YF_MIN_DELAY = 0.1  # Minimum delay between requests (reduced since we use batch downloads)
_YF_RATE_LIMIT_DELAY = 30  # Delay when rate limited (seconds)

def yf_rate_limit_delay():
    """Add delay between yfinance requests to avoid rate limiting"""
    global _last_yf_request, _yf_request_count
    if _last_yf_request:
        elapsed = time.time() - _last_yf_request
        if elapsed < _YF_MIN_DELAY:
            time.sleep(_YF_MIN_DELAY - elapsed + random.uniform(0.1, 0.3))
    _last_yf_request = time.time()
    _yf_request_count += 1

# Simple in-memory cache for market data
_market_data_cache = {}
_cache_timestamp = None
CACHE_DURATION_SECONDS = 600  # Cache for 10 minutes

def format_number_with_commas(value, decimals=2):
    """
    Format a number with commas as thousands separators.
    
    Args:
        value (float): The number to format
        decimals (int): Number of decimal places
    
    Returns:
        str: Formatted string with commas
    """
    try:
        return locale.format_string(f"%.{decimals}f", value, grouping=True)
    except:
        # Fallback formatting if locale doesn't work
        return f"{value:,.{decimals}f}"

# Market Indicator Symbols (yfinance format or FRED series):
# ----------------------------------------------------------
# GSPC: S&P 500
# DJI: DOW
# IXIC: Nasdaq
# N/A: CALL/PUT Ratio (derived from options data, no single symbol)
# N/A: AAII Retailer Investor Sentiment (survey data, no symbol)
# VIX: VIX (Fear Index)
# DGS10: 10-Yr Yield (FRED series)
# BTC-USD: Bitcoin
# GC=F: Gold
# SI=F: Silver
# CL=F: Crude Oil
# ^RUT: Russell 2000
# DGS2: 2-Yr Yield (FRED series)
# ETH-USD: Ethereum
# HG=F: Copper
# NG=F: Natural Gas
# ----------------------------------------------------------

def fetch_all_tickers_batch(tickers):
    """
    Fetch data for all tickers in a single batch download.
    This is MUCH faster than fetching one ticker at a time.
    
    Uses 1 year of daily data for week/month/year, and intraday data for day.
    
    Args:
        tickers (list): List of ticker symbols
    
    Returns:
        dict: {ticker: {timeframes: {...}, rv: float, rv_grade: str}}
    """
    global _market_data_cache, _cache_timestamp
    
    # Check cache
    cache_key = ','.join(sorted(tickers))
    if _cache_timestamp and (time.time() - _cache_timestamp) < CACHE_DURATION_SECONDS:
        if cache_key in _market_data_cache:
            print("Returning cached market data")
            return _market_data_cache[cache_key]
    
    import pandas as pd
    import yfinance as yf
    
    # Filter out non-yfinance tickers
    yf_tickers = [t for t in tickers if not t.startswith('DGS') and t not in ['CALL/PUT Ratio', 'CRYPTO-FEAR-GREED']]
    fred_tickers = [t for t in tickers if t.startswith('DGS')]
    special_tickers = [t for t in tickers if t in ['CALL/PUT Ratio', 'CRYPTO-FEAR-GREED']]
    
    result = {}
    service = FinancialDataService()
    
    # Store intraday data for day sparklines
    intraday_data = {}
    
    # Batch download all yfinance tickers at once - this is the key optimization!
    df_year = None
    df_intraday = None
    
    if yf_tickers:
        print(f"Batch downloading {len(yf_tickers)} tickers...")
        start_time = time.time()
        
        # Retry logic with exponential backoff for rate limiting
        max_retries = 3
        retry_delay = 5  # Initial delay in seconds
        
        for attempt in range(max_retries):
            try:
                yf_rate_limit_delay()  # Add delay between requests
                
                with yf_lock:
                    # Suppress yfinance stdout/stderr warnings (e.g., "possibly delisted")
                    old_stdout, old_stderr = sys.stdout, sys.stderr
                    sys.stdout, sys.stderr = StringIO(), StringIO()
                    try:
                        # Download 1 year of daily data for all tickers at once
                        df_year = yf.download(
                            yf_tickers, 
                            period='1y', 
                            interval='1d', 
                            progress=False,
                            group_by='ticker',
                            threads=True  # Use threading for faster download
                        )
                        
                        # Check if we got data or hit rate limit
                        if df_year is None or df_year.empty:
                            raise Exception("Empty response - possible rate limit")
                        
                        # Also download intraday data (5-min intervals, last 2 days) for day sparklines
                        df_intraday = yf.download(
                            yf_tickers,
                            period='2d',
                            interval='5m',
                            progress=False,
                            group_by='ticker',
                            threads=True,
                            prepost=True  # Include pre/post market
                        )
                    finally:
                        sys.stdout, sys.stderr = old_stdout, old_stderr
                
                print(f"Batch download completed in {time.time() - start_time:.2f}s")
                break  # Success, exit retry loop
                
            except Exception as e:
                error_msg = str(e).lower()
                if 'rate' in error_msg or 'limit' in error_msg or 'too many' in error_msg or 'empty' in error_msg:
                    if attempt < max_retries - 1:
                        wait_time = retry_delay * (2 ** attempt) + random.uniform(1, 3)
                        print(f"Rate limited, waiting {wait_time:.1f}s before retry {attempt + 2}/{max_retries}...")
                        time.sleep(wait_time)
                    else:
                        print(f"Rate limit persists after {max_retries} attempts. Using cached/empty data.")
                        df_year = pd.DataFrame()
                        df_intraday = pd.DataFrame()
                else:
                    print(f"yfinance error: {e}")
                    df_year = pd.DataFrame() if df_year is None else df_year
                    df_intraday = pd.DataFrame() if df_intraday is None else df_intraday
                    break
        
        # Process intraday data for each ticker
        if df_intraday is not None and not df_intraday.empty:
            for ticker in yf_tickers:
                try:
                    if len(yf_tickers) == 1:
                        intraday_df = df_intraday.copy()
                        if isinstance(intraday_df.columns, pd.MultiIndex):
                            intraday_df.columns = intraday_df.columns.droplevel(1)
                    else:
                        if ticker in df_intraday.columns.get_level_values(0):
                            intraday_df = df_intraday[ticker].copy()
                        else:
                            intraday_df = pd.DataFrame()
                    
                    if not intraday_df.empty and 'Close' in intraday_df.columns:
                        intraday_df = intraday_df.dropna(subset=['Close'])
                        # Get last trading day's data only (filter to most recent day)
                        if not intraday_df.empty:
                            last_date = intraday_df.index[-1].date()
                            day_mask = intraday_df.index.date == last_date
                            day_df = intraday_df[day_mask]
                            if not day_df.empty:
                                intraday_data[ticker] = day_df['Close'].tolist()
                except Exception as e:
                    print(f"Error processing intraday for {ticker}: {e}")
        
        # Process each ticker from the batch data
        if df_year is not None and not df_year.empty:
            for ticker in yf_tickers:
                try:
                    # Extract data for this ticker
                    if len(yf_tickers) == 1:
                        ticker_df = df_year.copy()
                        # Single ticker doesn't have multi-level columns
                        if isinstance(ticker_df.columns, pd.MultiIndex):
                            ticker_df.columns = ticker_df.columns.droplevel(1)
                    else:
                        # Multi-ticker download has ticker as top-level column
                        if ticker in df_year.columns.get_level_values(0):
                            ticker_df = df_year[ticker].copy()
                        else:
                            # Try with different column structure
                            ticker_df = df_year.xs(ticker, axis=1, level=0).copy()
                    
                    if ticker_df.empty or 'Close' not in ticker_df.columns:
                        result[ticker] = {'error': f'No data for {ticker}'}
                        continue
                    
                    # Drop NaN rows
                    ticker_df = ticker_df.dropna(subset=['Close'])
                    
                    if ticker_df.empty:
                        result[ticker] = {'error': f'No valid data for {ticker}'}
                        continue
                    
                    # Calculate timeframes from daily data
                    timeframe_data = {}
                    
                    # Get timezone info
                    eastern = pytz.timezone('US/Eastern')
                    now = pd.Timestamp.now(tz=eastern)
                    market_open = pd.Timestamp(now.date(), tz=eastern).replace(hour=9, minute=30)
                    market_close = pd.Timestamp(now.date(), tz=eastern).replace(hour=16, minute=0)
                    is_after_hours = not (now.weekday() < 5 and market_open <= now <= market_close)
                    
                    closes = ticker_df['Close'].tolist()
                    latest_close = float(closes[-1])
                    latest_datetime = ticker_df.index[-1]
                    if hasattr(latest_datetime, 'strftime'):
                        latest_datetime_str = latest_datetime.strftime('%m/%d/%y')
                    else:
                        latest_datetime_str = str(latest_datetime)[:10]
                    
                    # Year: all data (up to 252 trading days)
                    year_closes = closes[-252:] if len(closes) >= 252 else closes
                    year_change = round(((year_closes[-1] - year_closes[0]) / year_closes[0]) * 100, 2) if len(year_closes) >= 2 else 0
                    year_value_change = round(year_closes[-1] - year_closes[0], 2) if len(year_closes) >= 2 else 0
                    timeframe_data['year'] = {
                        'closes': year_closes,
                        'latest': {
                            'datetime': latest_datetime_str,
                            'close': format_number_with_commas(latest_close),
                            'change': year_change,
                            'value_change': year_value_change,
                            'is_after_hours': is_after_hours
                        }
                    }
                    
                    # Month: last 21 trading days
                    month_closes = closes[-21:] if len(closes) >= 21 else closes
                    month_change = round(((month_closes[-1] - month_closes[0]) / month_closes[0]) * 100, 2) if len(month_closes) >= 2 else 0
                    month_value_change = round(month_closes[-1] - month_closes[0], 2) if len(month_closes) >= 2 else 0
                    timeframe_data['month'] = {
                        'closes': month_closes,
                        'latest': {
                            'datetime': latest_datetime_str,
                            'close': format_number_with_commas(latest_close),
                            'change': month_change,
                            'value_change': month_value_change,
                            'is_after_hours': is_after_hours
                        }
                    }
                    
                    # Week: last 5 trading days
                    week_closes = closes[-5:] if len(closes) >= 5 else closes
                    week_change = round(((week_closes[-1] - week_closes[0]) / week_closes[0]) * 100, 2) if len(week_closes) >= 2 else 0
                    week_value_change = round(week_closes[-1] - week_closes[0], 2) if len(week_closes) >= 2 else 0
                    timeframe_data['week'] = {
                        'closes': week_closes,
                        'latest': {
                            'datetime': latest_datetime_str,
                            'close': format_number_with_commas(latest_close),
                            'change': week_change,
                            'value_change': week_value_change,
                            'is_after_hours': is_after_hours
                        }
                    }
                    
                    # Day: Use intraday data for sparkline (5-min intervals)
                    # Get yesterday's close for change calculation
                    yesterday_close = closes[-2] if len(closes) >= 2 else closes[-1]
                    day_change = round(((latest_close - yesterday_close) / yesterday_close) * 100, 2) if yesterday_close else 0
                    day_value_change = round(latest_close - yesterday_close, 2) if yesterday_close else 0
                    
                    # Use intraday closes for sparkline, fallback to daily if not available
                    day_sparkline = intraday_data.get(ticker, closes[-1:])
                    
                    timeframe_data['day'] = {
                        'closes': day_sparkline,
                        'latest': {
                            'datetime': latest_datetime_str,
                            'close': format_number_with_commas(latest_close),
                            'change': day_change,
                            'value_change': day_value_change,
                            'is_after_hours': is_after_hours
                        }
                    }
                    
                    # Calculate RV from the same data (no extra API call!)
                    rv = None
                    rv_grade = None
                    if 'Volume' in ticker_df.columns:
                        volumes = ticker_df['Volume'].tolist()
                        if len(volumes) >= 20:
                            avg_vol = sum(volumes[-20:]) / 20
                            last_vol = volumes[-1]
                            if avg_vol > 0:
                                rv = round(last_vol / avg_vol, 2)
                                rv_grade = service.grade_rv(rv)
                    
                    result[ticker] = {
                        'timeframes': timeframe_data,
                        'rv': rv,
                        'rv_grade': rv_grade
                    }
                    
                except Exception as e:
                    print(f"Error processing {ticker}: {e}")
                    result[ticker] = {'error': str(e)}
        else:
            # No data returned - set errors for all yf tickers
            for ticker in yf_tickers:
                if ticker not in result:
                    result[ticker] = {'error': f'No data for {ticker}'}
    
    # Fallback: Retry failed tickers individually using yf.Ticker()
    failed_tickers = [t for t in yf_tickers if result.get(t, {}).get('error')]
    if failed_tickers:
        print(f"Retrying {len(failed_tickers)} failed tickers individually: {failed_tickers}")
        for ticker in failed_tickers:
            try:
                yf_rate_limit_delay()
                with yf_lock:
                    old_stdout, old_stderr = sys.stdout, sys.stderr
                    sys.stdout, sys.stderr = StringIO(), StringIO()
                    try:
                        t = yf.Ticker(ticker)
                        hist = t.history(period='1y', interval='1d')
                    finally:
                        sys.stdout, sys.stderr = old_stdout, old_stderr
                
                if hist is not None and not hist.empty and 'Close' in hist.columns:
                    hist = hist.dropna(subset=['Close'])
                    if not hist.empty:
                        closes = hist['Close'].tolist()
                        latest_close = float(closes[-1])
                        latest_datetime = hist.index[-1]
                        latest_datetime_str = latest_datetime.strftime('%m/%d/%y') if hasattr(latest_datetime, 'strftime') else str(latest_datetime)[:10]
                        
                        # Get timezone info
                        eastern = pytz.timezone('US/Eastern')
                        now = pd.Timestamp.now(tz=eastern)
                        market_open = pd.Timestamp(now.date(), tz=eastern).replace(hour=9, minute=30)
                        market_close = pd.Timestamp(now.date(), tz=eastern).replace(hour=16, minute=0)
                        is_after_hours = not (now.weekday() < 5 and market_open <= now <= market_close)
                        
                        timeframe_data = {}
                        
                        # Year
                        year_closes = closes[-252:] if len(closes) >= 252 else closes
                        year_change = round(((year_closes[-1] - year_closes[0]) / year_closes[0]) * 100, 2) if len(year_closes) >= 2 else 0
                        year_value_change = round(year_closes[-1] - year_closes[0], 2) if len(year_closes) >= 2 else 0
                        timeframe_data['year'] = {
                            'closes': year_closes,
                            'latest': {'datetime': latest_datetime_str, 'close': format_number_with_commas(latest_close), 'change': year_change, 'value_change': year_value_change, 'is_after_hours': is_after_hours}
                        }
                        
                        # Month
                        month_closes = closes[-21:] if len(closes) >= 21 else closes
                        month_change = round(((month_closes[-1] - month_closes[0]) / month_closes[0]) * 100, 2) if len(month_closes) >= 2 else 0
                        month_value_change = round(month_closes[-1] - month_closes[0], 2) if len(month_closes) >= 2 else 0
                        timeframe_data['month'] = {
                            'closes': month_closes,
                            'latest': {'datetime': latest_datetime_str, 'close': format_number_with_commas(latest_close), 'change': month_change, 'value_change': month_value_change, 'is_after_hours': is_after_hours}
                        }
                        
                        # Week
                        week_closes = closes[-5:] if len(closes) >= 5 else closes
                        week_change = round(((week_closes[-1] - week_closes[0]) / week_closes[0]) * 100, 2) if len(week_closes) >= 2 else 0
                        week_value_change = round(week_closes[-1] - week_closes[0], 2) if len(week_closes) >= 2 else 0
                        timeframe_data['week'] = {
                            'closes': week_closes,
                            'latest': {'datetime': latest_datetime_str, 'close': format_number_with_commas(latest_close), 'change': week_change, 'value_change': week_value_change, 'is_after_hours': is_after_hours}
                        }
                        
                        # Day
                        yesterday_close = closes[-2] if len(closes) >= 2 else closes[-1]
                        day_change = round(((latest_close - yesterday_close) / yesterday_close) * 100, 2) if yesterday_close else 0
                        day_value_change = round(latest_close - yesterday_close, 2) if yesterday_close else 0
                        # For day sparkline, use last 5 daily closes if no intraday data available
                        day_sparkline = intraday_data.get(ticker, closes[-5:] if len(closes) >= 5 else closes)
                        
                        # Debug: Print day calculation values
                        print(f"[DEBUG {ticker}] Day calc: latest={latest_close}, yesterday={yesterday_close}, change={day_change}%, value_change={day_value_change}")
                        
                        timeframe_data['day'] = {
                            'closes': day_sparkline,
                            'latest': {'datetime': latest_datetime_str, 'close': format_number_with_commas(latest_close), 'change': day_change, 'value_change': day_value_change, 'is_after_hours': is_after_hours}
                        }
                        
                        # Calculate RV
                        rv = None
                        rv_grade = None
                        if 'Volume' in hist.columns:
                            volumes = hist['Volume'].tolist()
                            if len(volumes) >= 20:
                                avg_vol = sum(volumes[-20:]) / 20
                                last_vol = volumes[-1]
                                if avg_vol > 0:
                                    rv = round(last_vol / avg_vol, 2)
                                    rv_grade = service.grade_rv(rv)
                        
                        result[ticker] = {
                            'timeframes': timeframe_data,
                            'rv': rv,
                            'rv_grade': rv_grade
                        }
                        print(f"Successfully fetched {ticker} individually")
            except Exception as e:
                print(f"Individual fetch for {ticker} also failed: {e}")
                # Keep the original error
    
    # Handle FRED tickers (treasury yields) - these are fast
    for ticker in fred_tickers:
        try:
            data = service.fetch_data(ticker)
            result[ticker] = {
                'timeframes': data,
                'rv': None,
                'rv_grade': None
            }
        except Exception as e:
            result[ticker] = {'error': str(e)}
    
    # Handle CALL/PUT Ratio - fetch from CBOE
    for ticker in special_tickers:
        if ticker == 'CALL/PUT Ratio':
            try:
                call_put_data = service._fetch_call_put_ratio_data()
                result[ticker] = {
                    'timeframes': call_put_data,
                    'rv': None,
                    'rv_grade': None
                }
            except Exception as e:
                logger.error(f"Error fetching CALL/PUT Ratio: {e}")
                # Fallback with generated sparkline data
                result[ticker] = {
                    'timeframes': service._build_call_put_timeframe_data([], 0.85, datetime.now()),
                    'rv': None,
                    'rv_grade': None
                }
        elif ticker == 'CRYPTO-FEAR-GREED':
            try:
                fear_greed_data = service._fetch_crypto_fear_greed()
                result[ticker] = {
                    'timeframes': fear_greed_data,
                    'rv': None,
                    'rv_grade': None
                }
            except Exception as e:
                logger.error(f"Error fetching Crypto Fear & Greed: {e}")
                # Fallback with neutral value
                result[ticker] = {
                    'timeframes': service._build_fear_greed_timeframe_data([], 50, datetime.now()),
                    'rv': None,
                    'rv_grade': None
                }
    
    # Update cache
    _market_data_cache[cache_key] = result
    _cache_timestamp = time.time()
    
    return result


class FinancialDataService:
    @staticmethod
    def grade_rv(rv):
        """
        Grade the Relative Volume based on its value.
        
        Args:
            rv (float): Relative Volume value (e.g., 1.2 for 1.2x)
        
        Returns:
            str: Grade ('Very Low', 'Low', 'Normal', 'High', 'Very High', 'Extreme')
        """
        if rv < 0.5:
            return 'Very Low'
        elif rv < 0.8:
            return 'Low'
        elif rv < 1.2:
            return 'Normal'
        elif rv < 1.5:
            return 'High'
        elif rv < 2.0:
            return 'Very High'
        else:
            return 'Extreme'
    
    def fetch_data(self, ticker):
        """
        Fetch data for all timeframes (Day, Week, Month, Year) in a single call.
        
        Args:
            ticker (str): Ticker symbol (e.g., 'AAPL', '^GSPC') or FRED series (e.g., 'DGS10').
        
        Returns:
            dict: Data for all timeframes with sparklines and latest values
        """
        try:
            # Handle CALL/PUT Ratio specially
            if ticker == 'CALL/PUT Ratio':
                return self._fetch_call_put_ratio_data()
            
            # Handle FRED series for Treasury yields
            if ticker.startswith('DGS'):
                import pandas as pd
                import requests
                import csv
                from io import StringIO
                
                url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={ticker}"
                response = requests.get(url, timeout=10)
                if response.status_code != 200:
                    raise ValueError(f"No data from FRED for {ticker}")
                
                reader = csv.DictReader(StringIO(response.text))
                data = []
                for row in reader:
                    value_str = row.get(ticker, '')
                    if value_str and value_str != '.':
                        data.append({
                            'date': pd.to_datetime(row['observation_date']),
                            'value': float(value_str)
                        })
                
                if not data:
                    raise ValueError(f"No data found for {ticker}")
                
                # Sort by date
                data.sort(key=lambda x: x['date'])
                
                # Get data for different timeframes
                timeframe_data = {}
                
                # Year: last 365 days (daily)
                year_data = data[-365:] if len(data) >= 365 else data
                year_closes = [d['value'] for d in year_data]
                timeframe_data['year'] = {
                    'closes': year_closes,
                    'latest': {
                        'datetime': year_data[-1]['date'].strftime('%m/%d/%y'),
                        'close': format_number_with_commas(year_closes[-1]),
                        'change': self._calculate_change(year_closes, 'year'),
                        'value_change': self._calculate_value_change(year_closes, 'year'),
                        'is_after_hours': False
                    }
                }
                
                # Month: last 30 days (daily)
                month_data = data[-30:] if len(data) >= 30 else data
                month_closes = [d['value'] for d in month_data]
                timeframe_data['month'] = {
                    'closes': month_closes,
                    'latest': {
                        'datetime': month_data[-1]['date'].strftime('%m/%d/%y'),
                        'close': format_number_with_commas(month_closes[-1]),
                        'change': self._calculate_change(month_closes, 'month'),
                        'value_change': self._calculate_value_change(month_closes, 'month'),
                        'is_after_hours': False
                    }
                }
                
                # Week: last 7 days (daily)
                week_data = data[-7:] if len(data) >= 7 else data
                week_closes = [d['value'] for d in week_data]
                timeframe_data['week'] = {
                    'closes': week_closes,
                    'latest': {
                        'datetime': week_data[-1]['date'].strftime('%m/%d/%y'),
                        'close': format_number_with_commas(week_closes[-1]),
                        'change': self._calculate_change(week_closes, 'week'),
                        'value_change': self._calculate_value_change(week_closes, 'week'),
                        'is_after_hours': False
                    }
                }
                
                # Day: For FRED data, show last 5 trading days since there's no intraday data
                # This gives users a sense of recent movement even on the "day" view
                day_data = data[-5:] if len(data) >= 5 else data
                day_closes = [d['value'] for d in day_data]
                
                # Calculate change from previous day if we have at least 2 data points
                if len(day_closes) >= 2:
                    day_change = round(((day_closes[-1] - day_closes[-2]) / day_closes[-2]) * 100, 2)
                    day_value_change = round(day_closes[-1] - day_closes[-2], 2)
                else:
                    day_change = 0.0
                    day_value_change = 0.0
                
                timeframe_data['day'] = {
                    'closes': day_closes,
                    'latest': {
                        'datetime': day_data[-1]['date'].strftime('%m/%d/%y'),
                        'close': format_number_with_commas(day_closes[-1]),
                        'change': day_change,
                        'value_change': day_value_change,
                        'is_after_hours': False,
                        'is_daily_only': True  # Flag to indicate no intraday data available
                    }
                }
                
                return timeframe_data
            
            # Use yfinance for all tickers except FRED series
            if not ticker.startswith('DGS'):
                import pandas as pd
                import yfinance as yf
                
                timeframe_data = {}
                
                # Fetch data for different timeframes
                timeframes = {
                    'day': {'period': '2d', 'interval': '5m'},      # 5-minute intervals for day
                    'week': {'period': '5d', 'interval': '1h'},     # 1-hour intervals for week
                    'month': {'period': '1mo', 'interval': '4h'},    # 4-hour intervals for month
                    'year': {'period': '1y', 'interval': '1d'}       # Daily for year
                }
                
                # First get yesterday's close for day timeframe calculation
                yesterday_close = None
                try:
                    with yf_lock:
                        daily_df = yf.download(ticker, period='5d', interval='1d', progress=False)
                    if not daily_df.empty:
                        daily_df.columns = daily_df.columns.droplevel(1)
                        # Get the second to last close (yesterday's close)
                        if len(daily_df) >= 2:
                            yesterday_close = float(daily_df['Close'].iloc[-2])
                except:
                    pass  # If we can't get yesterday's close, we'll use the default calculation
                
                for tf_name, tf_params in timeframes.items():
                    try:
                        with yf_lock:
                            df = yf.download(ticker, period=tf_params['period'], interval=tf_params['interval'], prepost=True, progress=False)
                        
                        if df.empty:
                            # Provide default empty data for this timeframe
                            timeframe_data[tf_name] = {
                                'closes': [],
                                'latest': {
                                    'datetime': '',
                                    'close': 0.0,
                                    'change': 0.0,
                                    'is_after_hours': False
                                }
                            }
                            continue
                        
                        # Flatten MultiIndex columns for single ticker
                        df.columns = df.columns.droplevel(1)
                        
                        # Reset index to make Datetime a column
                        df.reset_index(inplace=True)
                        
                        # Handle different index names (Datetime vs Date)
                        datetime_col = None
                        if 'Datetime' in df.columns:
                            datetime_col = 'Datetime'
                        elif 'Date' in df.columns:
                            datetime_col = 'Date'
                        
                        if datetime_col:
                            # Ensure Datetime column is datetime type and convert to US/Eastern timezone
                            df[datetime_col] = pd.to_datetime(df[datetime_col])
                            if df[datetime_col].dt.tz is None:
                                df[datetime_col] = df[datetime_col].dt.tz_localize('UTC')
                            df[datetime_col] = df[datetime_col].dt.tz_convert('US/Eastern')
                            
                            df.set_index(datetime_col, inplace=True)
                            df.sort_index(inplace=True)
                        else:
                            raise ValueError(f"No datetime column found in dataframe for {tf_name}")
                        
                        # Get all closes in chronological order (oldest to newest)
                        closes = df['Close'].tolist()
                        
                        # Latest data
                        latest = df.iloc[-1]
                        latest_datetime = df.index[-1].strftime('%m/%d/%y - %I:%M %p')
                        latest_close = float(latest['Close'])
                        
                        # Determine if after hours
                        eastern = pytz.timezone('US/Eastern')
                        now = pd.Timestamp.now(tz=eastern)
                        market_open = pd.Timestamp(now.date(), tz=eastern).replace(hour=9, minute=30)
                        market_close = pd.Timestamp(now.date(), tz=eastern).replace(hour=16, minute=0)
                        is_after_hours = not (now.weekday() < 5 and market_open <= now <= market_close)
                        
                        # Special handling for day timeframe - calculate change from yesterday's close
                        if tf_name == 'day' and yesterday_close is not None:
                            change = round(((latest_close - yesterday_close) / yesterday_close) * 100, 2)
                            value_change = round(latest_close - yesterday_close, 2)
                        else:
                            change = self._calculate_change(closes, tf_name)
                            value_change = self._calculate_value_change(closes, tf_name)
                        
                        timeframe_data[tf_name] = {
                            'closes': closes,
                            'latest': {
                                'datetime': latest_datetime,
                                'close': format_number_with_commas(latest_close),
                                'change': change,
                                'value_change': value_change,
                                'is_after_hours': is_after_hours
                            }
                        }
                    except Exception as e:
                        # Provide default empty data for this timeframe on error
                        timeframe_data[tf_name] = {
                            'closes': [],
                            'latest': {
                                'datetime': '',
                                'close': 0.0,
                                'change': 0.0,
                                'is_after_hours': False
                            }
                        }
                
                return timeframe_data
        except Exception as e:
            raise ValueError(f"Error fetching data for {ticker}: {e}")

    def _calculate_change(self, closes, timeframe):
        """
        Calculate percentage change based on timeframe.
        
        Args:
            closes (list): List of closing prices
            timeframe (str): 'day', 'week', 'month', or 'year'
        
        Returns:
            float: Percentage change
        """
        if len(closes) < 2:
            return 0.0
        
        latest_close = closes[-1]
        
        # For all timeframes, compare to the first value in the period
        # This gives the change from the beginning of the timeframe to now
        prev_close = closes[0]
        
        return round(((latest_close - prev_close) / prev_close) * 100, 2)

    def _calculate_value_change(self, closes, timeframe):
        """
        Calculate absolute value change based on timeframe.
        
        Args:
            closes (list): List of closing prices
            timeframe (str): 'day', 'week', 'month', or 'year'
        
        Returns:
            float: Absolute value change
        """
        if len(closes) < 2:
            return 0.0
        
        latest_close = closes[-1]
        prev_close = closes[0]
        
        return round(latest_close - prev_close, 2)

    def _calculate_call_put_change(self, ratio, timeframe):
        """
        Calculate percentage change for CALL/PUT ratio from neutral baseline.
        
        Interpretation:
        - < 0.7 = Bullish sentiment (more calls than puts)
        - 0.7 - 1.0 = Neutral
        - > 1.0 = Bearish sentiment (more puts than calls)
        
        Args:
            ratio (float): Current CALL/PUT ratio
            timeframe (str): 'day', 'week', 'month', or 'year'
        
        Returns:
            float: Percentage change from neutral baseline (0.85)
        """
        # Use 0.85 as neutral baseline (center of 0.7-1.0 neutral range)
        baseline = 0.85
        change = ((ratio - baseline) / baseline) * 100
        return round(change, 2)

    def _generate_call_put_sparkline(self, current_ratio, timeframe, num_points):
        """
        Generate a deterministic sparkline for CALL/PUT ratio using mean-reversion.
        
        Args:
            current_ratio (float): Current CALL/PUT ratio
            timeframe (str): 'day', 'week', 'month', or 'year'
            num_points (int): Number of sparkline points
        
        Returns:
            list: Sparkline data ending at current_ratio
        """
        import math
        
        # Neutral mean for CALL/PUT ratio (center of 0.7-1.0 range)
        mean_ratio = 0.85
        
        # Volatility by timeframe
        vol_map = {'day': 0.08, 'week': 0.12, 'month': 0.15, 'year': 0.20}
        volatility = vol_map.get(timeframe, 0.08)
        
        sparkline = [current_ratio]
        seed = int(current_ratio * 1000) + hash(timeframe) % 1000
        
        for i in range(num_points - 1, 0, -1):
            progress = i / num_points
            angle = (seed + i * 137.508) % 360
            pseudo_random = math.sin(math.radians(angle)) * 0.5 + 0.5
            
            # Mean reversion + volatility
            mean_pull = (mean_ratio - sparkline[0]) * 0.2 * (1 - progress)
            vol_component = (pseudo_random - 0.5) * volatility * 2
            
            prev_point = sparkline[0] - mean_pull + vol_component
            # Bounds: 0.3 (very bullish) to 2.0 (very bearish)
            prev_point = max(0.3, min(2.0, prev_point))
            sparkline.insert(0, round(prev_point, 3))
        
        return sparkline

    def _fetch_call_put_ratio_data(self):
        """
        Fetch CALL/PUT Ratio data from CBOE (Chicago Board Options Exchange).
        
        Uses CBOE's official Put/Call ratio which is the industry standard.
        Data source: https://www.cboe.com/us/options/market_statistics/
        
        Interpretation:
        - < 0.7 = Bullish sentiment (more calls than puts)
        - 0.7 - 1.0 = Neutral
        - > 1.0 = Bearish sentiment (more puts than calls)
        """
        logger = logging.getLogger(__name__)
        try:
            import requests
            import pandas as pd
            from datetime import datetime, timedelta
            from io import StringIO
            
            today = datetime.now()
            
            # CBOE provides historical put/call ratio data
            # We'll fetch the Total Put/Call Ratio (equity + index)
            cboe_url = "https://cdn.cboe.com/api/global/us_options/market_statistics/daily_ratios/total_pc_ratios.csv"
            
            logger.info("Fetching CBOE Put/Call Ratio data...")
            
            try:
                response = requests.get(cboe_url, timeout=10, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                response.raise_for_status()
                
                # Parse CSV data
                df = pd.read_csv(StringIO(response.text))
                
                # CBOE CSV typically has columns: DATE, TOTAL_PC_RATIO
                if 'DATE' in df.columns:
                    df['DATE'] = pd.to_datetime(df['DATE'])
                    df = df.sort_values('DATE', ascending=True)
                
                # Get the ratio column (might be named differently)
                ratio_col = None
                for col in ['TOTAL_PC_RATIO', 'PC_RATIO', 'RATIO', 'Total']:
                    if col in df.columns:
                        ratio_col = col
                        break
                
                if ratio_col and len(df) > 0:
                    # Use actual CBOE historical data for sparklines
                    ratios = df[ratio_col].dropna().tolist()
                    current_ratio = ratios[-1] if ratios else 0.85
                    
                    logger.info(f"CBOE Put/Call Ratio: {current_ratio:.3f} (from {len(ratios)} days of data)")
                    
                    return self._build_call_put_timeframe_data(ratios, current_ratio, today)
                    
            except requests.RequestException as e:
                logger.warning(f"Failed to fetch CBOE data: {e}, trying alternative source...")
            
            # Alternative: Fetch from CBOE equity-only put/call ratio
            try:
                equity_url = "https://cdn.cboe.com/api/global/us_options/market_statistics/daily_ratios/equity_pc_ratios.csv"
                response = requests.get(equity_url, timeout=10, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                response.raise_for_status()
                
                df = pd.read_csv(StringIO(response.text))
                if 'DATE' in df.columns:
                    df['DATE'] = pd.to_datetime(df['DATE'])
                    df = df.sort_values('DATE', ascending=True)
                
                ratio_col = None
                for col in df.columns:
                    if 'ratio' in col.lower() or 'pc' in col.lower():
                        ratio_col = col
                        break
                
                if ratio_col and len(df) > 0:
                    ratios = df[ratio_col].dropna().tolist()
                    current_ratio = ratios[-1] if ratios else 0.85
                    logger.info(f"CBOE Equity Put/Call Ratio: {current_ratio:.3f}")
                    return self._build_call_put_timeframe_data(ratios, current_ratio, today)
                    
            except requests.RequestException as e:
                logger.warning(f"Failed to fetch CBOE equity data: {e}")
            
            # Fallback: Use typical market values
            logger.warning("Using fallback Put/Call ratio values")
            return self._build_call_put_timeframe_data([], 0.85, today)
            
        except Exception as e:
            logger.error(f"Error fetching CBOE Put/Call Ratio data: {e}")
            return self._build_call_put_timeframe_data([], 0.85, datetime.now())

    def _build_call_put_timeframe_data(self, historical_ratios, current_ratio, today):
        """
        Build timeframe data structure for CALL/PUT ratio.
        
        Args:
            historical_ratios: List of historical ratios (most recent last)
            current_ratio: Current/latest ratio value
            today: Current datetime
        
        Returns:
            dict: Timeframe data with sparklines and latest values
        """
        from datetime import datetime
        
        timeframe_data = {}
        
        # Sparkline point counts for each timeframe
        sparkline_config = {
            'day': 24,    # Hourly points for day view (simulated from daily)
            'week': 7,    # Daily points for week
            'month': 30,  # Daily points for month
            'year': 52    # Weekly points for year
        }
        
        for tf_name, num_points in sparkline_config.items():
            if historical_ratios and len(historical_ratios) >= num_points:
                # Use actual historical data
                if tf_name == 'day':
                    # For day view, interpolate from recent daily data
                    recent = historical_ratios[-5:] if len(historical_ratios) >= 5 else historical_ratios
                    sparkline = self._interpolate_sparkline(recent, num_points)
                elif tf_name == 'week':
                    sparkline = historical_ratios[-num_points:]
                elif tf_name == 'month':
                    sparkline = historical_ratios[-num_points:]
                else:  # year - sample weekly from daily data
                    # Take every 5th value to approximate weekly
                    yearly_data = historical_ratios[-260:] if len(historical_ratios) >= 260 else historical_ratios
                    step = max(1, len(yearly_data) // num_points)
                    sparkline = yearly_data[::step][-num_points:]
                
                # Ensure sparkline has correct number of points
                while len(sparkline) < num_points:
                    sparkline.insert(0, sparkline[0] if sparkline else current_ratio)
                sparkline = sparkline[-num_points:]
                
                # Calculate change from first to last point
                first_val = sparkline[0] if sparkline else current_ratio
                change = self._calculate_call_put_change(current_ratio, tf_name)
            else:
                # Generate synthetic sparkline using mean-reversion
                sparkline = self._generate_call_put_sparkline(current_ratio, tf_name, num_points)
                change = self._calculate_call_put_change(current_ratio, tf_name)
            
            # Round sparkline values
            sparkline = [round(v, 3) for v in sparkline]
            
            timeframe_data[tf_name] = {
                'closes': sparkline,
                'latest': {
                    'datetime': today.strftime('%m/%d/%y'),
                    'close': format_number_with_commas(current_ratio),
                    'change': change,
                    'value_change': 0.0,
                    'is_after_hours': False
                }
            }
        
        return timeframe_data

    def _interpolate_sparkline(self, data, num_points):
        """Interpolate sparse data to fill sparkline points."""
        import numpy as np
        
        if len(data) == 0:
            return [0.85] * num_points
        if len(data) == 1:
            return [data[0]] * num_points
        
        # Linear interpolation
        x_orig = np.linspace(0, 1, len(data))
        x_new = np.linspace(0, 1, num_points)
        interpolated = np.interp(x_new, x_orig, data)
        
        return interpolated.tolist()

    def _fetch_crypto_fear_greed(self):
        """
        Fetch Crypto Fear & Greed Index from Alternative.me API.
        
        The index is a 0-100 score:
        - 0-25: Extreme Fear
        - 25-50: Fear
        - 50-75: Greed
        - 75-100: Extreme Greed
        
        API: https://api.alternative.me/fng/?limit=365
        """
        logger = logging.getLogger(__name__)
        try:
            import requests
            from datetime import datetime
            
            # Fetch last 365 days of data
            url = "https://api.alternative.me/fng/?limit=365"
            
            logger.info("Fetching Crypto Fear & Greed Index...")
            
            response = requests.get(url, timeout=10, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            response.raise_for_status()
            
            data = response.json()
            
            if 'data' in data and len(data['data']) > 0:
                # Data comes newest first, so reverse it
                fear_greed_data = data['data'][::-1]
                
                # Extract values (they're strings in the API response)
                values = [int(item['value']) for item in fear_greed_data]
                current_value = values[-1] if values else 50
                
                logger.info(f"Crypto Fear & Greed Index: {current_value} (from {len(values)} days of data)")
                
                return self._build_fear_greed_timeframe_data(values, current_value, datetime.now())
            
            logger.warning("No data in Crypto Fear & Greed response")
            return self._build_fear_greed_timeframe_data([], 50, datetime.now())
            
        except Exception as e:
            logger.error(f"Error fetching Crypto Fear & Greed Index: {e}")
            return self._build_fear_greed_timeframe_data([], 50, datetime.now())

    def _build_fear_greed_timeframe_data(self, historical_values, current_value, today):
        """
        Build timeframe data structure for Crypto Fear & Greed Index.
        
        Args:
            historical_values: List of historical values (oldest first, 0-100 scale)
            current_value: Current/latest value
            today: Current datetime
        
        Returns:
            dict: Timeframe data with sparklines and latest values
        """
        from datetime import datetime
        
        timeframe_data = {}
        
        # Sparkline point counts for each timeframe
        sparkline_config = {
            'day': 24,    # For day view, we'll interpolate
            'week': 7,    # Daily points for week
            'month': 30,  # Daily points for month
            'year': 52    # Weekly points for year
        }
        
        for tf_name, num_points in sparkline_config.items():
            if historical_values and len(historical_values) >= 2:
                if tf_name == 'day':
                    # For day view, interpolate from recent daily data
                    recent = historical_values[-5:] if len(historical_values) >= 5 else historical_values
                    sparkline = self._interpolate_fear_greed(recent, num_points)
                elif tf_name == 'week':
                    sparkline = historical_values[-num_points:] if len(historical_values) >= num_points else historical_values
                elif tf_name == 'month':
                    sparkline = historical_values[-num_points:] if len(historical_values) >= num_points else historical_values
                else:  # year - sample weekly from daily data
                    yearly_data = historical_values[-365:] if len(historical_values) >= 365 else historical_values
                    step = max(1, len(yearly_data) // num_points)
                    sparkline = yearly_data[::step][-num_points:]
                
                # Ensure sparkline has correct number of points
                while len(sparkline) < num_points:
                    sparkline.insert(0, sparkline[0] if sparkline else current_value)
                sparkline = sparkline[-num_points:]
                
                # Calculate change from first to last point
                first_val = sparkline[0] if sparkline else current_value
                change = round(((current_value - first_val) / first_val) * 100, 2) if first_val > 0 else 0
            else:
                # Generate synthetic sparkline
                sparkline = self._generate_fear_greed_sparkline(current_value, tf_name, num_points)
                change = 0
            
            # Round sparkline values
            sparkline = [round(v, 1) for v in sparkline]
            
            timeframe_data[tf_name] = {
                'closes': sparkline,
                'latest': {
                    'datetime': today.strftime('%m/%d/%y'),
                    'close': str(int(current_value)),
                    'change': change,
                    'value_change': 0.0,
                    'is_after_hours': False
                }
            }
        
        return timeframe_data

    def _interpolate_fear_greed(self, data, num_points):
        """Interpolate Fear & Greed data to fill sparkline points."""
        import numpy as np
        
        if len(data) == 0:
            return [50] * num_points
        if len(data) == 1:
            return [data[0]] * num_points
        
        # Linear interpolation
        x_orig = np.linspace(0, 1, len(data))
        x_new = np.linspace(0, 1, num_points)
        interpolated = np.interp(x_new, x_orig, data)
        
        return interpolated.tolist()

    def _generate_fear_greed_sparkline(self, current_value, timeframe, num_points):
        """
        Generate a deterministic sparkline for Fear & Greed Index using mean-reversion.
        """
        import math
        
        # Neutral mean for Fear & Greed (50 = neutral)
        mean_value = 50
        
        # Volatility by timeframe
        vol_map = {'day': 5, 'week': 10, 'month': 15, 'year': 20}
        volatility = vol_map.get(timeframe, 5)
        
        sparkline = [current_value]
        seed = int(current_value * 100) + hash(timeframe) % 1000
        
        for i in range(num_points - 1, 0, -1):
            progress = i / num_points
            angle = (seed + i * 137.508) % 360
            pseudo_random = math.sin(math.radians(angle)) * 0.5 + 0.5
            
            # Mean reversion + volatility
            mean_pull = (mean_value - sparkline[0]) * 0.15 * (1 - progress)
            vol_component = (pseudo_random - 0.5) * volatility * 2
            
            prev_point = sparkline[0] - mean_pull + vol_component
            # Bounds: 0 to 100
            prev_point = max(0, min(100, prev_point))
            sparkline.insert(0, round(prev_point, 1))
        
        return sparkline

    def fetch_relative_volume(self, ticker):
        """
        Calculate daily and weekly Relative Volume (RV) for a ticker.
        
        Args:
            ticker (str): Ticker symbol.
        
        Returns:
            dict: {'daily_rv': float, 'weekly_rv': float}
        """
        # FRED series, CALL/PUT Ratio, and Crypto Fear & Greed don't have volume data
        if ticker.startswith('DGS') or ticker in ['CALL/PUT Ratio', 'CRYPTO-FEAR-GREED']:
            return {
                'daily_rv': None,
                'daily_grade': None,
                'weekly_rv': None,
                'weekly_grade': None
            }
        
        try:
            # Use yfinance for all tickers except FRED series
            if not ticker.startswith('DGS'):
                import pandas as pd
                import yfinance as yf
                # Fetch 6 months of daily data
                with yf_lock:
                    df = yf.download(ticker, period='6mo', interval='1d', progress=False)
                if df.empty:
                    raise ValueError(f"No data for {ticker}")
                
                # Flatten MultiIndex columns for single ticker
                df.columns = df.columns.droplevel(1)
                
                if 'Volume' not in df.columns:
                    raise ValueError(f"No volume data for {ticker}")
                
                # Daily RV: Last day's volume / 20-day average
                avg_daily_vol = df['Volume'].rolling(20).mean().iloc[-1]
                last_daily_vol = df['Volume'].iloc[-1]
                daily_rv = last_daily_vol / avg_daily_vol if avg_daily_vol > 0 else 0
                
                # Weekly RV: Last week's volume / 4-week average weekly volume
                df_weekly = df.resample('W').sum()  # Aggregate to weekly
                avg_weekly_vol = df_weekly['Volume'].rolling(4).mean().iloc[-1]
                last_weekly_vol = df_weekly['Volume'].iloc[-1]
                weekly_rv = last_weekly_vol / avg_weekly_vol if avg_weekly_vol > 0 else 0
                
                return {
                    'daily_rv': round(daily_rv, 2), 
                    'daily_grade': self.grade_rv(daily_rv),
                    'weekly_rv': round(weekly_rv, 2),
                    'weekly_grade': self.grade_rv(weekly_rv)
                }
        except Exception as e:
            raise ValueError(f"Error calculating RV for {ticker}: {e}")

import sys
import json

def fetch_watchlist(tickers_csv: str):
    """Fetch data for a comma-separated list of tickers and print JSON to stdout.

    Output format (example):
    {
      "^GSPC": {
         "close": 5210.45,
         "change": 0.82,
         "sparkline": [5180,5190,...],
         "is_after_hours": false,
         "rv": 1.23,
         "rv_grade": "Normal"
      },
      ...
    }
    """
    service = FinancialDataService()
    result = {}
    tickers = [t.strip() for t in tickers_csv.split(',') if t.strip()]

    import time
    for ticker in tickers:
        try:
            # Small delay to avoid rate limiting (Alpha Vantage free tier: 5 calls/min)
            time.sleep(2)
            data = service.fetch_data(ticker)

            # Use change from fetch_data
            change = data['latest']['change']

            # Relative volume (daily)
            try:
                rv_info = service.fetch_relative_volume(ticker)
                rv = rv_info.get('daily_rv', None)
                rv_grade = rv_info.get('daily_grade', None)
            except Exception:
                rv = None
                rv_grade = None

            # Sparkline: last up to 24 closes
            sparkline = data.get('closes', [])[-24:]

            result[ticker] = {
                'close': data['latest']['close'] if data.get('latest') else None,
                'change': change,
                'sparkline': sparkline,
                'is_after_hours': data['latest']['is_after_hours'],
                'rv': rv,
                'rv_grade': rv_grade
            }
        except Exception as e:
            result[ticker] = {'error': str(e)}

    print(json.dumps(result))


def fetch_stock_detail(symbol, timeframe='day'):
    """
    Fetch detailed stock data for a single ticker.
    
    Args:
        symbol (str): Ticker symbol
        timeframe (str): 'day', 'week', 'month', or 'year'
    
    Returns:
        dict: Detailed stock information including price, change, statistics, sparkline, and timestamps
    """
    import pandas as pd
    import yfinance as yf
    
    try:
        with yf_lock:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            
            # Determine period and interval based on timeframe
            timeframe_config = {
                'day': {'period': '2d', 'interval': '5m'},
                'week': {'period': '7d', 'interval': '1h'},
                'month': {'period': '1mo', 'interval': '1d'},
                'year': {'period': '1y', 'interval': '1d'},
            }
            
            config = timeframe_config.get(timeframe, timeframe_config['day'])
            
            # Fetch historical data
            hist = ticker.history(period=config['period'], interval=config['interval'], prepost=True)
            
            if hist.empty:
                return None
            
            # Get closes for sparkline
            closes = hist['Close'].dropna().tolist()
            
            # Get timestamps for chart axis
            timestamps = []
            for ts in hist.index:
                if timeframe == 'day':
                    # For day view, show time only (h:MM am/pm)
                    timestamps.append(ts.strftime('%I:%M%p').lstrip('0').lower())
                elif timeframe == 'week':
                    # For week view, show day and time (Mon h:MMam)
                    timestamps.append(ts.strftime('%a %I:%M%p').replace(' 0', ' ').lower())
                elif timeframe == 'month':
                    # For month view, show date (Jan 15)
                    timestamps.append(ts.strftime('%b %d').replace(' 0', ' '))
                else:
                    # For year view, show month and date (Jan 15)
                    timestamps.append(ts.strftime('%b %d').replace(' 0', ' '))
            
            # Calculate change
            if len(closes) >= 2:
                current_price = closes[-1]
                # For day, compare to previous day's close or first value
                if timeframe == 'day' and len(closes) > 1:
                    # Find first close of today
                    today = hist.index[-1].date()
                    today_mask = hist.index.date == today
                    if today_mask.any():
                        first_today_idx = hist.index[today_mask][0]
                        # Get previous close (last close before today)
                        prev_closes = hist.loc[hist.index < first_today_idx, 'Close'].dropna()
                        if not prev_closes.empty:
                            prev_close = prev_closes.iloc[-1]
                        else:
                            prev_close = closes[0]
                    else:
                        prev_close = closes[0]
                else:
                    prev_close = closes[0]
                
                value_change = current_price - prev_close
                pct_change = (value_change / prev_close * 100) if prev_close != 0 else 0
            else:
                current_price = closes[-1] if closes else 0
                value_change = 0
                pct_change = 0
                prev_close = current_price
            
            # Get today's high/low from intraday data or info
            if timeframe == 'day':
                today = hist.index[-1].date()
                today_data = hist[hist.index.date == today]
                high = today_data['High'].max() if not today_data.empty else info.get('dayHigh')
                low = today_data['Low'].min() if not today_data.empty else info.get('dayLow')
                open_price = today_data['Open'].iloc[0] if not today_data.empty else info.get('open')
            else:
                high = hist['High'].max()
                low = hist['Low'].min()
                open_price = hist['Open'].iloc[0] if not hist.empty else None
            
            result = {
                'symbol': symbol,
                'name': info.get('shortName') or info.get('longName') or symbol,
                'price': current_price,
                'change': pct_change,
                'valueChange': value_change,
                'high': high,
                'low': low,
                'open': open_price,
                'previousClose': info.get('previousClose') or prev_close,
                'volume': info.get('volume'),
                'avgVolume': info.get('averageVolume'),
                'marketCap': info.get('marketCap'),
                'pe': info.get('trailingPE'),
                'week52High': info.get('fiftyTwoWeekHigh'),
                'week52Low': info.get('fiftyTwoWeekLow'),
                'sparkline': closes[-100:],  # Last 100 data points for chart
                'timestamps': timestamps[-100:],  # Last 100 timestamps matching sparkline
            }
            
            return result
            
    except Exception as e:
        print(f"Error fetching stock detail for {symbol}: {e}")
        return None


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == 'fetch_watchlist':
        tickers_csv = sys.argv[2]
        fetch_watchlist(tickers_csv)
    else:
        # Fallback test/demo
        print(json.dumps({'^GSPC': {'close': None, 'change': 0.0, 'sparkline': [], 'is_after_hours': False, 'rv': None, 'rv_grade': None}}))


# =============================================================================
# Live Screens Service - DYNAMIC Market Scanner
# =============================================================================
# Goal	                Recommended Size
# MVP/Beta	            100-300 (current is fine)
# Production Launch	    500-1,000
# Competitive Product	2,000-3,000
# Robinhood Scale	    11,000+
# ----------------------------------------------------------------------------
# Universe of stocks to scan - liquid, tradeable stocks across sectors
SCAN_UNIVERSE = [
    # ==========================================================================
    # MEGA-CAP TECH (20)
    # ==========================================================================
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'AVGO', 'ORCL',
    'ADBE', 'CRM', 'AMD', 'INTC', 'QCOM', 'TXN', 'AMAT', 'MU', 'LRCX', 'KLAC',
    
    # ==========================================================================
    # GROWTH TECH / SOFTWARE (28)
    # ==========================================================================
    'NFLX', 'PYPL', 'SHOP', 'SNOW', 'DDOG', 'CRWD', 'NET', 'ZS', 'PANW',
    'PLTR', 'COIN', 'HOOD', 'SOFI', 'AFRM', 'UPST', 'RBLX', 'U', 'ROKU', 'TTD',
    'SNAP', 'PINS', 'TWLO', 'OKTA', 'MDB', 'ESTC', 'DOCN', 'PATH', 'S', 'GTLB',
    
    # ==========================================================================
    # AI / SEMICONDUCTORS (25)
    # ==========================================================================
    'SMCI', 'ARM', 'MRVL', 'ON', 'MPWR', 'MCHP', 'NXPI', 'SWKS', 'QRVO', 'ADI',
    'SNPS', 'CDNS', 'ASML', 'TSM', 'WOLF', 'CRUS', 'SLAB', 'SITM', 'ALGM', 'ACLS',
    'LSCC', 'RMBS', 'POWI', 'DIOD', 'AMBA',
    
    # ==========================================================================
    # EV / CLEAN ENERGY (19)
    # ==========================================================================
    'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'PLUG', 'FCEL', 'CHPT', 'BLNK', 'QS',
    'ENPH', 'SEDG', 'FSLR', 'RUN', 'ARRY', 'STEM', 'EVGO', 'BLDP', 'BE',
    
    # ==========================================================================
    # FINANCE / BANKS (26)
    # ==========================================================================
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'USB', 'PNC', 'SCHW', 'BLK',
    'V', 'MA', 'AXP', 'COF', 'SYF', 'ALLY', 'MTB', 'FITB', 'KEY',
    'CFG', 'HBAN', 'RF', 'ZION', 'CMA', 'WAL', 'FHN',
    
    # ==========================================================================
    # HEALTHCARE / BIOTECH (34)
    # ==========================================================================
    'JNJ', 'UNH', 'PFE', 'MRK', 'ABBV', 'LLY', 'TMO', 'ABT', 'BMY', 'AMGN',
    'GILD', 'MRNA', 'BNTX', 'REGN', 'VRTX', 'BIIB', 'ILMN', 'DXCM', 'ISRG', 'ZTS',
    'CI', 'HUM', 'ELV', 'CVS', 'MCK', 'CAH', 'CNC', 'MOH', 'HCA', 'DHR',
    'EXAS', 'INCY', 'ALNY', 'SRPT',
    
    # ==========================================================================
    # CONSUMER / RETAIL (30)
    # ==========================================================================
    'WMT', 'COST', 'HD', 'LOW', 'TGT', 'SBUX', 'MCD', 'NKE', 'LULU', 'DIS',
    'CMCSA', 'NFLX', 'ABNB', 'BKNG', 'EXPE', 'MAR', 'HLT', 'RCL', 'CCL', 'WYNN',
    'LVS', 'MGM', 'DPZ', 'CMG', 'DASH', 'UBER', 'LYFT', 'YUM', 'QSR', 'WING',
    
    # ==========================================================================
    # INDUSTRIAL / AEROSPACE / DEFENSE (25)
    # ==========================================================================
    'CAT', 'DE', 'BA', 'RTX', 'LMT', 'GE', 'HON', 'UPS', 'FDX', 'MMM',
    'EMR', 'ITW', 'PH', 'ROK', 'ETN', 'IR', 'CARR', 'OTIS', 'NOC', 'GD',
    'TXT', 'HII', 'LHX', 'AXON', 'TDG',
    
    # ==========================================================================
    # ENERGY / OIL & GAS (17)
    # ==========================================================================
    'XOM', 'CVX', 'COP', 'SLB', 'OXY', 'DVN', 'HAL', 'BKR', 'EOG',
    'FANG', 'VLO', 'MPC', 'PSX', 'KMI', 'WMB', 'OKE', 'TRGP',
    
    # ==========================================================================
    # TELECOM / MEDIA (12)
    # ==========================================================================
    'T', 'VZ', 'TMUS', 'CHTR', 'WBD', 'FOX', 'FOXA', 'LUMN',
    'SIRI', 'MTCH', 'IAC', 'ZG',
    
    # ==========================================================================
    # MEME / HIGH SHORT INTEREST / SPECULATIVE (9)
    # ==========================================================================
    'GME', 'AMC', 'CVNA', 'MARA', 'RIOT', 'BITF', 'HUT', 'CLSK', 'WKHS',
    
    # ==========================================================================
    # QUANTUM / SPACE / EVTOL / SPECULATIVE TECH (13)
    # ==========================================================================
    'IONQ', 'RGTI', 'QUBT', 'ARQQ', 'JOBY', 'ACHR', 'SPCE', 'RDW',
    'RKLB', 'LUNR', 'ASTS', 'SATL', 'BKSY',
    
    # ==========================================================================
    # VALUE / DIVIDEND / DEFENSIVE (22)
    # ==========================================================================
    'F', 'GM', 'IBM', 'KO', 'PEP', 'PG', 'CL', 'KMB', 'GIS',
    'SJM', 'CPB', 'HRL', 'MKC', 'CLX', 'CHD', 'EL', 'KHC', 'MDLZ',
    'HSY', 'TAP', 'STZ', 'DEO',
    
    # ==========================================================================
    # REITS (15)
    # ==========================================================================
    'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'WELL', 'DLR', 'AVB',
    'EQR', 'VTR', 'ARE', 'MAA', 'UDR',
    
    # ==========================================================================
    # SECTOR ETFs (10)
    # ==========================================================================
    'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE',
]
# Total: ~300 stocks

# Screen definitions - criteria for dynamic scanning
SCREEN_DEFINITIONS = {
    'morning-movers': {
        'id': 'morning-movers',
        'title': 'Morning Movers',
        'description': 'Top gainers with high volume today',
        'icon': '🚀',
        'category': 'momentum',
        'criteria': 'top_gainers',  # Filter function to use
        'limit': 5,
        'refreshInterval': 15,  # Refresh every 15 minutes
    },
    'unusual-volume': {
        'id': 'unusual-volume',
        'title': 'Unusual Volume',
        'description': 'Stocks trading 2x+ their average volume',
        'icon': '🔥',
        'category': 'unusual',
        'criteria': 'unusual_volume',
        'limit': 5,
        'refreshInterval': 15,
    },
    'oversold-bounces': {
        'id': 'oversold-bounces',
        'title': 'Oversold Bounces',
        'description': 'Stocks with RSI < 35 showing reversal',
        'icon': '📉',
        'category': 'technical',
        'criteria': 'oversold',
        'limit': 5,
        'refreshInterval': 30,
    },
    'overbought-warning': {
        'id': 'overbought-warning',
        'title': 'Overbought Warning',
        'description': 'Stocks with RSI > 70 - potential pullback',
        'icon': '⚠️',
        'category': 'technical',
        'criteria': 'overbought',
        'limit': 5,
        'refreshInterval': 30,
    },
    'volatility-squeeze': {
        'id': 'volatility-squeeze',
        'title': 'Volatility Squeeze',
        'description': 'Low volatility stocks ready to move',
        'icon': '⚡',
        'category': 'volatility',
        'criteria': 'volatility_squeeze',
        'limit': 5,
        'refreshInterval': 60,
    },
    'breakout-watch': {
        'id': 'breakout-watch',
        'title': 'Breakout Watch',
        'description': 'Stocks near 52-week highs with momentum',
        'icon': '📊',
        'category': 'technical',
        'criteria': 'near_highs',
        'limit': 5,
        'refreshInterval': 30,
    },
    'sector-leaders': {
        'id': 'sector-leaders',
        'title': 'Sector Leaders',
        'description': 'Top performing sector ETFs today',
        'icon': '🏭',
        'category': 'sector',
        'criteria': 'sector_etfs',
        'limit': 5,
        'refreshInterval': 30,
    },
    'value-plays': {
        'id': 'value-plays',
        'title': 'Value Plays',
        'description': 'Low P/E stocks with positive momentum',
        'icon': '💎',
        'category': 'value',
        'criteria': 'value_stocks',
        'limit': 5,
        'refreshInterval': 60,
    },
}

# Cache for live screens data
_live_screens_cache = {}
_live_screens_cache_timestamp = None
LIVE_SCREENS_CACHE_DURATION = 300  # 5 minutes - can be adjusted

# Cache for scanned market data (longer cache since it's expensive)
_market_scan_cache = {}
_market_scan_timestamp = None
MARKET_SCAN_CACHE_DURATION = 600  # 10 minutes - scanning 300 stocks is expensive


class LiveScreensService:
    """Service for DYNAMIC market scanning and stock screens."""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    @staticmethod
    def get_market_times():
        """Get market open/close times for today."""
        eastern = pytz.timezone('US/Eastern')
        now = datetime.now(eastern)
        market_open = now.replace(hour=9, minute=30, second=0, microsecond=0)
        market_close = now.replace(hour=16, minute=0, second=0, microsecond=0)
        return market_open, market_close
    
    @staticmethod
    def calculate_rsi(closes, period=14):
        """Calculate RSI for a list of closing prices."""
        if len(closes) < period + 1:
            return None
        
        deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
        gains = [d if d > 0 else 0 for d in deltas]
        losses = [-d if d < 0 else 0 for d in deltas]
        
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        
        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        
        if avg_loss == 0:
            return 100
        rs = avg_gain / avg_loss
        return round(100 - (100 / (1 + rs)), 1)
    
    @staticmethod
    def calculate_bollinger_width(closes, period=20):
        """Calculate Bollinger Band width (volatility indicator)."""
        if len(closes) < period:
            return None
        
        recent = closes[-period:]
        sma = sum(recent) / period
        variance = sum((x - sma) ** 2 for x in recent) / period
        std = variance ** 0.5
        
        if sma == 0:
            return None
        
        # BB width as percentage of price
        width = (2 * std / sma) * 100
        return round(width, 2)
    
    def scan_market(self):
        """
        Scan the entire universe and calculate metrics for all stocks.
        This is cached to avoid repeated expensive API calls.
        """
        global _market_scan_cache, _market_scan_timestamp
        
        # Check cache
        if _market_scan_timestamp and (time.time() - _market_scan_timestamp) < MARKET_SCAN_CACHE_DURATION:
            if _market_scan_cache:
                print("Returning cached market scan data")
                return _market_scan_cache
        
        import yfinance as yf
        import pandas as pd
        
        print(f"🔍 Scanning {len(SCAN_UNIVERSE)} stocks...")
        start_time = time.time()
        
        scanned_data = {}
        
        try:
            with yf_lock:
                # Batch download 1 month of daily data for all tickers
                df_daily = yf.download(
                    SCAN_UNIVERSE,
                    period='1mo',
                    interval='1d',
                    progress=False,
                    group_by='ticker',
                    threads=True
                )
                
                # Also get intraday for sparklines
                df_intraday = yf.download(
                    SCAN_UNIVERSE,
                    period='1d',
                    interval='5m',
                    progress=False,
                    group_by='ticker',
                    threads=True
                )
            
            # Process each ticker
            for ticker in SCAN_UNIVERSE:
                try:
                    # Extract data
                    if len(SCAN_UNIVERSE) == 1:
                        daily_df = df_daily.copy()
                        intraday_df = df_intraday.copy()
                    else:
                        if ticker not in df_daily.columns.get_level_values(0):
                            continue
                        daily_df = df_daily[ticker].copy()
                        intraday_df = df_intraday[ticker].copy() if ticker in df_intraday.columns.get_level_values(0) else pd.DataFrame()
                    
                    if daily_df.empty or 'Close' not in daily_df.columns:
                        continue
                    
                    daily_df = daily_df.dropna(subset=['Close'])
                    if len(daily_df) < 5:
                        continue
                    
                    closes = daily_df['Close'].tolist()
                    volumes = daily_df['Volume'].tolist() if 'Volume' in daily_df.columns else []
                    highs = daily_df['High'].tolist() if 'High' in daily_df.columns else []
                    lows = daily_df['Low'].tolist() if 'Low' in daily_df.columns else []
                    
                    current_price = float(closes[-1])
                    prev_close = float(closes[-2]) if len(closes) >= 2 else current_price
                    
                    # Calculate metrics
                    change_pct = round(((current_price - prev_close) / prev_close) * 100, 2) if prev_close else 0
                    value_change = round(current_price - prev_close, 2)
                    
                    # Relative volume
                    rv = None
                    if len(volumes) >= 5:
                        avg_vol = sum(volumes[-5:-1]) / 4 if len(volumes) > 4 else sum(volumes[:-1]) / (len(volumes) - 1)
                        if avg_vol > 0 and volumes[-1]:
                            rv = round(volumes[-1] / avg_vol, 2)
                    
                    # RSI
                    rsi = self.calculate_rsi(closes)
                    
                    # Bollinger Band width
                    bb_width = self.calculate_bollinger_width(closes)
                    
                    # 52-week high/low proximity
                    high_52w = max(highs) if highs else current_price
                    low_52w = min(lows) if lows else current_price
                    pct_from_high = round(((current_price - high_52w) / high_52w) * 100, 2) if high_52w else 0
                    pct_from_low = round(((current_price - low_52w) / low_52w) * 100, 2) if low_52w else 0
                    
                    # Sparkline (prefer intraday)
                    sparkline = []
                    if not intraday_df.empty and 'Close' in intraday_df.columns:
                        sparkline = intraday_df['Close'].dropna().tolist()[-20:]
                    if not sparkline:
                        sparkline = closes[-20:]
                    
                    # Get company name (cached in yfinance)
                    try:
                        info = yf.Ticker(ticker).info
                        name = info.get('shortName') or info.get('longName') or ticker
                        pe_ratio = info.get('trailingPE')
                        dividend_yield = info.get('dividendYield')
                    except:
                        name = ticker
                        pe_ratio = None
                        dividend_yield = None
                    
                    scanned_data[ticker] = {
                        'symbol': ticker,
                        'name': name,
                        'price': current_price,
                        'change': change_pct,
                        'valueChange': value_change,
                        'rv': rv,
                        'rsi': rsi,
                        'bb_width': bb_width,
                        'pct_from_high': pct_from_high,
                        'pct_from_low': pct_from_low,
                        'sparkline': sparkline,
                        'pe_ratio': pe_ratio,
                        'dividend_yield': dividend_yield,
                        'volume': volumes[-1] if volumes else None,
                    }
                    
                except Exception as e:
                    print(f"Error scanning {ticker}: {e}")
                    continue
            
            elapsed = time.time() - start_time
            print(f"✅ Market scan complete: {len(scanned_data)} stocks in {elapsed:.1f}s")
            
            # Update cache
            _market_scan_cache = scanned_data
            _market_scan_timestamp = time.time()
            
            return scanned_data
            
        except Exception as e:
            print(f"❌ Market scan error: {e}")
            return _market_scan_cache or {}
    
    def filter_top_gainers(self, data, limit=5):
        """Filter for top gaining stocks with volume."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('change', 0) > 1  # At least 1% gain
            and info.get('rv', 0) and info['rv'] >= 1.0  # Normal or higher volume
        ]
        candidates.sort(key=lambda x: x[1]['change'], reverse=True)
        return candidates[:limit]
    
    def filter_unusual_volume(self, data, limit=5):
        """Filter for stocks with unusual volume (2x+ average)."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('rv', 0) and info['rv'] >= 2.0
        ]
        candidates.sort(key=lambda x: x[1]['rv'], reverse=True)
        return candidates[:limit]
    
    def filter_oversold(self, data, limit=5):
        """Filter for oversold stocks (RSI < 35) with positive momentum today."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('rsi') and info['rsi'] < 35
            and info.get('change', 0) > -2  # Not crashing today
        ]
        candidates.sort(key=lambda x: x[1]['rsi'])  # Lowest RSI first
        return candidates[:limit]
    
    def filter_overbought(self, data, limit=5):
        """Filter for overbought stocks (RSI > 70)."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('rsi') and info['rsi'] > 70
        ]
        candidates.sort(key=lambda x: x[1]['rsi'], reverse=True)  # Highest RSI first
        return candidates[:limit]
    
    def filter_volatility_squeeze(self, data, limit=5):
        """Filter for low volatility stocks (tight Bollinger Bands)."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('bb_width') and info['bb_width'] < 8  # Tight bands
        ]
        candidates.sort(key=lambda x: x[1]['bb_width'])  # Tightest first
        return candidates[:limit]
    
    def filter_near_highs(self, data, limit=5):
        """Filter for stocks near 52-week highs with momentum."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('pct_from_high') and info['pct_from_high'] > -5  # Within 5% of high
            and info.get('change', 0) > 0  # Positive today
            and info.get('rv', 0) and info['rv'] >= 1.0
        ]
        candidates.sort(key=lambda x: x[1]['pct_from_high'], reverse=True)  # Closest to high
        return candidates[:limit]
    
    def filter_sector_etfs(self, data, limit=5):
        """Filter sector ETFs and sort by performance."""
        sector_etfs = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE']
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if ticker in sector_etfs
        ]
        candidates.sort(key=lambda x: x[1].get('change', 0), reverse=True)
        return candidates[:limit]
    
    def filter_value_stocks(self, data, limit=5):
        """Filter for value stocks with low P/E and positive momentum."""
        candidates = [
            (ticker, info) for ticker, info in data.items()
            if info.get('pe_ratio') and 0 < info['pe_ratio'] < 15  # Low P/E
            and info.get('change', 0) > 0  # Positive today
        ]
        candidates.sort(key=lambda x: x[1]['pe_ratio'])  # Lowest P/E first
        return candidates[:limit]
    
    def generate_signals(self, ticker, info, screen_type):
        """Generate dynamic signals based on actual metrics."""
        signals = []
        
        # RSI signals
        rsi = info.get('rsi')
        if rsi:
            if rsi < 30:
                signals.append(f'RSI {rsi:.0f} (Oversold)')
            elif rsi < 40:
                signals.append(f'RSI {rsi:.0f}')
            elif rsi > 70:
                signals.append(f'RSI {rsi:.0f} (Overbought)')
            elif rsi > 60:
                signals.append(f'RSI {rsi:.0f}')
        
        # Volume signals
        rv = info.get('rv')
        if rv:
            if rv >= 3:
                signals.append(f'Volume {rv:.1f}x (Extreme)')
            elif rv >= 2:
                signals.append(f'Volume {rv:.1f}x (High)')
            elif rv >= 1.5:
                signals.append(f'Volume {rv:.1f}x')
        
        # Price position signals
        pct_from_high = info.get('pct_from_high', -100)
        pct_from_low = info.get('pct_from_low', 0)
        if pct_from_high > -2:
            signals.append('Near 52W High')
        elif pct_from_low < 10:
            signals.append('Near 52W Low')
        
        # BB width signals
        bb_width = info.get('bb_width')
        if bb_width and bb_width < 5:
            signals.append('BB Squeeze')
        
        # Change signals
        change = info.get('change', 0)
        if change > 5:
            signals.append('Big Mover')
        elif change > 3:
            signals.append('Strong Momentum')
        elif change < -5:
            signals.append('Sharp Drop')
        
        return signals[:4]  # Max 4 signals
    
    def generate_reason(self, ticker, info, screen_type):
        """Generate dynamic reason based on actual metrics."""
        change = info.get('change', 0)
        rv = info.get('rv')
        rsi = info.get('rsi')
        bb_width = info.get('bb_width')
        pct_from_high = info.get('pct_from_high')
        pe = info.get('pe_ratio')
        
        if screen_type == 'top_gainers':
            rv_text = f", RV {rv:.1f}x" if rv else ""
            return f"+{change:.1f}% today{rv_text}"
        
        elif screen_type == 'unusual_volume':
            return f"Volume {rv:.1f}x average, {'+' if change > 0 else ''}{change:.1f}%"
        
        elif screen_type == 'oversold':
            return f"RSI {rsi:.0f}, bouncing {'+' if change > 0 else ''}{change:.1f}%"
        
        elif screen_type == 'overbought':
            return f"RSI {rsi:.0f}, extended {'+' if change > 0 else ''}{change:.1f}%"
        
        elif screen_type == 'volatility_squeeze':
            return f"BB width {bb_width:.1f}%, coiling for breakout"
        
        elif screen_type == 'near_highs':
            return f"{pct_from_high:.1f}% from 52W high, momentum building"
        
        elif screen_type == 'sector_etfs':
            return f"Sector {'leading' if change > 0 else 'lagging'} {'+' if change > 0 else ''}{change:.1f}%"
        
        elif screen_type == 'value_stocks':
            return f"P/E {pe:.1f}, value with momentum"
        
        return f"{'+' if change > 0 else ''}{change:.1f}% today"
    
    def calculate_score(self, info, screen_type):
        """Calculate dynamic score based on metrics."""
        base_score = 70
        
        change = abs(info.get('change', 0))
        rv = info.get('rv', 1)
        rsi = info.get('rsi', 50)
        
        # Change contribution (up to 15 points)
        change_score = min(15, change * 3)
        
        # Volume contribution (up to 10 points)
        rv_score = 0
        if rv:
            if rv >= 3:
                rv_score = 10
            elif rv >= 2:
                rv_score = 7
            elif rv >= 1.5:
                rv_score = 4
        
        # RSI contribution for oversold/overbought screens
        rsi_score = 0
        if screen_type == 'oversold' and rsi and rsi < 30:
            rsi_score = 5
        elif screen_type == 'overbought' and rsi and rsi > 75:
            rsi_score = 5
        
        return min(99, int(base_score + change_score + rv_score + rsi_score))
    
    def fetch_live_screens(self, screen_ids=None, categories=None):
        """
        Fetch dynamically scanned live screens.
        
        Args:
            screen_ids: Optional list of specific screen IDs to filter by
            categories: Optional list of categories to filter by (legacy support)
        
        Returns:
            list: List of LiveScreen objects with real-time data
        """
        global _live_screens_cache, _live_screens_cache_timestamp
        
        # Check cache
        cache_key = ','.join(sorted(screen_ids)) if screen_ids else (','.join(sorted(categories)) if categories else 'all')
        if _live_screens_cache_timestamp and (time.time() - _live_screens_cache_timestamp) < LIVE_SCREENS_CACHE_DURATION:
            if cache_key in _live_screens_cache:
                print("Returning cached live screens")
                return _live_screens_cache[cache_key]
        
        # Scan the market
        market_data = self.scan_market()
        
        if not market_data:
            print("No market data available")
            return []
        
        # Filter screens by screen_ids first (takes priority), then by category
        screens_to_build = SCREEN_DEFINITIONS
        if screen_ids:
            screens_to_build = {
                k: v for k, v in SCREEN_DEFINITIONS.items()
                if k in screen_ids
            }
        elif categories:
            screens_to_build = {
                k: v for k, v in SCREEN_DEFINITIONS.items()
                if v['category'] in categories
            }
        
        # Build screens dynamically
        market_open, market_close = self.get_market_times()
        eastern = pytz.timezone('US/Eastern')
        now = datetime.now(eastern)
        
        screens = []
        
        for screen_id, definition in screens_to_build.items():
            criteria = definition['criteria']
            limit = definition.get('limit', 5)
            
            # Apply the appropriate filter
            filter_map = {
                'top_gainers': self.filter_top_gainers,
                'unusual_volume': self.filter_unusual_volume,
                'oversold': self.filter_oversold,
                'overbought': self.filter_overbought,
                'volatility_squeeze': self.filter_volatility_squeeze,
                'near_highs': self.filter_near_highs,
                'sector_etfs': self.filter_sector_etfs,
                'value_stocks': self.filter_value_stocks,
            }
            
            filter_func = filter_map.get(criteria)
            if not filter_func:
                continue
            
            filtered = filter_func(market_data, limit)
            
            # Build stocks list
            stocks = []
            for rank, (ticker, info) in enumerate(filtered, 1):
                stock = {
                    'symbol': ticker,
                    'name': info['name'],
                    'price': info['price'],
                    'change': info['change'],
                    'valueChange': info['valueChange'],
                    'sparkline': info['sparkline'],
                    'timeframe': 'day',
                    'screenReason': self.generate_reason(ticker, info, criteria),
                    'rank': rank,
                    'score': self.calculate_score(info, criteria),
                    'signals': self.generate_signals(ticker, info, criteria),
                }
                stocks.append(stock)
            
            # Calculate expiry based on refresh interval
            refresh_mins = definition.get('refreshInterval', 30)
            next_refresh = now + timedelta(minutes=refresh_mins)
            
            screen = {
                'id': definition['id'],
                'title': definition['title'],
                'description': definition['description'],
                'icon': definition['icon'],
                'category': definition['category'],
                'stocks': stocks,
                'generatedAt': now.isoformat(),
                'expiresAt': min(next_refresh, market_close).isoformat(),
                'refreshInterval': refresh_mins,
            }
            
            screens.append(screen)
        
        # Update cache
        _live_screens_cache[cache_key] = screens
        _live_screens_cache_timestamp = time.time()
        
        return screens


# Import pandas at module level for LiveScreensService
import pandas as pd


def get_historical_signals(ticker: str, timeframe: str = 'day', lookback_days: int = 365) -> dict:
    """
    Calculate historical BUY/SELL/HOLD signals for a ticker.
    Returns timestamps and price levels where signal changes occurred.
    """
    import numpy as np
    import yfinance as yf
    from datetime import datetime, timedelta
    
    try:
        # Determine period based on timeframe
        if timeframe == 'day':
            period = '6mo'
            interval = '1d'
        elif timeframe == 'week':
            period = '2y'
            interval = '1wk'
        elif timeframe == 'month':
            period = '5y'
            interval = '1mo'
        elif timeframe == 'year':
            period = '10y'
            interval = '1mo'
        else:
            period = '6mo'
            interval = '1d'
        
        stock = yf.Ticker(ticker)
        df = stock.history(period=period, interval=interval)
        
        if df.empty or len(df) < 20:
            return {'signals': [], 'error': None}
        
        # Calculate technical indicators for signal generation
        closes = df['Close'].values
        highs = df['High'].values
        lows = df['Low'].values
        volumes = df['Volume'].values
        
        # RSI calculation
        def calculate_rsi(prices, period=14):
            deltas = np.diff(prices)
            gains = np.where(deltas > 0, deltas, 0)
            losses = np.where(deltas < 0, -deltas, 0)
            
            rsi = np.zeros(len(prices))
            if len(gains) < period:
                return rsi
            
            avg_gain = np.zeros(len(prices))
            avg_loss = np.zeros(len(prices))
            
            # Initial SMA
            avg_gain[period] = np.mean(gains[:period])
            avg_loss[period] = np.mean(losses[:period])
            
            # EMA for subsequent values
            for i in range(period + 1, len(prices)):
                avg_gain[i] = (avg_gain[i-1] * (period - 1) + gains[i-1]) / period
                avg_loss[i] = (avg_loss[i-1] * (period - 1) + losses[i-1]) / period
            
            rs = np.where(avg_loss != 0, avg_gain / avg_loss, 0)
            rsi = 100 - (100 / (1 + rs))
            return rsi
        
        # MACD calculation
        def calculate_ema(prices, period):
            if len(prices) < period:
                return np.zeros(len(prices))
            ema = np.zeros(len(prices))
            multiplier = 2 / (period + 1)
            ema[period-1] = np.mean(prices[:period])
            for i in range(period, len(prices)):
                ema[i] = (prices[i] - ema[i-1]) * multiplier + ema[i-1]
            return ema
        
        ema12 = calculate_ema(closes, 12)
        ema26 = calculate_ema(closes, 26)
        macd_line = ema12 - ema26
        
        # Signal line - EMA of MACD
        signal_line_full = np.zeros(len(closes))
        if len(macd_line) > 35:
            signal_line = calculate_ema(macd_line[26:], 9)
            signal_line_full[26+8:] = signal_line[8:]
        
        rsi = calculate_rsi(closes)
        
        # ============================================================
        # VECTORIZED MONTE CARLO ENSEMBLE SIGNAL DETECTION
        # 100 MILLION iterations using NumPy vectorization for speed
        # ============================================================
        
        # Number of simulation iterations - 100 MILLION
        NUM_ITERATIONS = 100_000_000
        
        # Pre-calculate all indicators ONCE (vectorized)
        # ------------------------------------------------------------
        
        # Volume ratios
        avg_volume = np.mean(volumes) if len(volumes) > 0 else 1
        volume_ratio = volumes / avg_volume
        
        # SMA for trend context (vectorized with cumsum)
        sma_period = min(20, max(3, len(closes) // 3))
        cumsum = np.cumsum(np.insert(closes, 0, 0))
        sma = np.zeros(len(closes))
        sma[sma_period-1:] = (cumsum[sma_period:] - cumsum[:-sma_period]) / sma_period
        
        # Pre-compute rolling max/min for all possible lookbacks (1-4)
        # This avoids recalculating in each iteration
        rolling_max_highs = {}
        rolling_min_lows = {}
        
        for lb in [1, 2, 3, 4]:
            # Left-side rolling max/min
            left_max = np.zeros(len(highs))
            left_min = np.full(len(lows), np.inf)
            for i in range(lb, len(highs)):
                left_max[i] = np.max(highs[i-lb:i])
                left_min[i] = np.min(lows[i-lb:i])
            
            # Right-side rolling max/min
            right_max = np.zeros(len(highs))
            right_min = np.full(len(lows), np.inf)
            for i in range(len(highs) - lb):
                right_max[i] = np.max(highs[i+1:i+lb+1])
                right_min[i] = np.min(lows[i+1:i+lb+1])
            
            rolling_max_highs[lb] = (left_max, right_max)
            rolling_min_lows[lb] = (left_min, right_min)
        
        # Pre-compute peak/trough masks for each lookback
        peak_masks = {}
        trough_masks = {}
        
        for lb in [1, 2, 3, 4]:
            left_max, right_max = rolling_max_highs[lb]
            left_min, right_min = rolling_min_lows[lb]
            
            # Peak: high > left_max AND high > right_max
            peak_mask = (highs > left_max) & (highs > right_max)
            peak_mask[:lb] = False
            peak_mask[-lb:] = False
            peak_masks[lb] = peak_mask
            
            # Trough: low < left_min AND low < right_min
            trough_mask = (lows < left_min) & (lows < right_min)
            trough_mask[:lb] = False
            trough_mask[-lb:] = False
            trough_masks[lb] = trough_mask
        
        # Pre-compute trend bonuses (price above/below SMA)
        above_sma = (sma > 0) & (closes > sma)
        below_sma = (sma > 0) & (closes < sma)
        
        # Choppiness detection function (kept for HOLD signals later)
        def is_choppy(idx, window=10):
            start = max(0, idx - window)
            end = min(len(closes), idx + window)
            if end - start < 5:
                return False, 0
            local_highs = highs[start:end]
            local_lows = lows[start:end]
            price_range = (max(local_highs) - min(local_lows)) / min(local_lows)
            changes = 0
            for j in range(start + 1, end):
                if j > start + 1:
                    prev_dir = closes[j-1] - closes[j-2]
                    curr_dir = closes[j] - closes[j-1]
                    if prev_dir * curr_dir < 0:
                        changes += 1
            change_ratio = changes / (end - start - 2) if end - start > 2 else 0
            is_chop = price_range < 0.04 and change_ratio > 0.4
            return is_chop, price_range
        
        # ------------------------------------------------------------
        # VECTORIZED MONTE CARLO - Process in batches for memory efficiency
        # ------------------------------------------------------------
        BATCH_SIZE = 500_000  # Process 500k iterations at a time
        num_batches = NUM_ITERATIONS // BATCH_SIZE
        
        # Parameter options
        lookback_options = np.array([1, 2, 3, 4])
        significance_options = np.array([0.03, 0.04, 0.05, 0.06, 0.07, 0.08])
        volume_weight_options = np.array([0.0, 0.5, 1.0, 1.5])
        trend_weight_options = np.array([0.0, 0.5, 1.0])
        
        # Accumulators
        buy_votes = np.zeros(len(closes), dtype=np.float64)
        sell_votes = np.zeros(len(closes), dtype=np.float64)
        
        print(f"Running {NUM_ITERATIONS:,} Monte Carlo iterations...")
        
        for batch in range(num_batches):
            # Generate random parameters for this batch
            np.random.seed(batch * 12345)  # Reproducible but varied
            
            batch_lookbacks = np.random.choice(lookback_options, BATCH_SIZE)
            batch_significances = np.random.choice(significance_options, BATCH_SIZE)
            batch_vol_weights = np.random.choice(volume_weight_options, BATCH_SIZE)
            batch_trend_weights = np.random.choice(trend_weight_options, BATCH_SIZE)
            
            # Count parameter combinations for each lookback
            for lb in [1, 2, 3, 4]:
                lb_mask = batch_lookbacks == lb
                lb_count = np.sum(lb_mask)
                
                if lb_count == 0:
                    continue
                
                # Get pre-computed peak/trough masks for this lookback
                peak_mask = peak_masks[lb]
                trough_mask = trough_masks[lb]
                
                peak_indices = np.where(peak_mask)[0]
                trough_indices = np.where(trough_mask)[0]
                
                # For each significance threshold, filter and vote
                for sig in significance_options:
                    sig_lb_mask = lb_mask & (batch_significances == sig)
                    sig_count = np.sum(sig_lb_mask)
                    
                    if sig_count == 0:
                        continue
                    
                    # Get volume and trend weights for this subset
                    subset_vol_weights = batch_vol_weights[sig_lb_mask]
                    subset_trend_weights = batch_trend_weights[sig_lb_mask]
                    
                    # Average weights for scoring (approximation for speed)
                    avg_vol_weight = np.mean(subset_vol_weights)
                    avg_trend_weight = np.mean(subset_trend_weights)
                    
                    # Process peaks (SELL signals)
                    if len(peak_indices) > 0:
                        # Filter by significance (check if move from prev trough is significant)
                        # Simplified: just vote for all peaks, weight by count
                        for pidx in peak_indices:
                            vol_bonus = (volume_ratio[pidx] - 1.0) * avg_vol_weight
                            trend_bonus = avg_trend_weight if above_sma[pidx] else 0
                            score = (1.0 + vol_bonus + trend_bonus) * sig_count
                            sell_votes[pidx] += score
                    
                    # Process troughs (BUY signals)
                    if len(trough_indices) > 0:
                        for tidx in trough_indices:
                            vol_bonus = (volume_ratio[tidx] - 1.0) * avg_vol_weight
                            trend_bonus = avg_trend_weight if below_sma[tidx] else 0
                            score = (1.0 + vol_bonus + trend_bonus) * sig_count
                            buy_votes[tidx] += score
        
        print(f"Monte Carlo complete. Processing consensus...")
        
        # ------------------------------------------------------------
        # AGGREGATE VOTES INTO CONSENSUS SIGNALS
        # ------------------------------------------------------------
        # Normalize votes - use relative strength between buy/sell
        max_buy = np.max(buy_votes) if np.max(buy_votes) > 0 else 1
        max_sell = np.max(sell_votes) if np.max(sell_votes) > 0 else 1
        
        buy_pct = buy_votes / max_buy * 100
        sell_pct = sell_votes / max_sell * 100
        
        # Consensus threshold - lower = more signals
        CONSENSUS_THRESHOLD = 10  # Top 10% strength signals (lowered for 1B iterations)
        
        # Find bars with strong consensus
        consensus_signals = []
        
        for i in range(len(closes)):
            if buy_pct[i] >= CONSENSUS_THRESHOLD and buy_pct[i] > sell_pct[i]:
                consensus_signals.append((i, 'BUY', buy_pct[i], lows[i]))
            elif sell_pct[i] >= CONSENSUS_THRESHOLD and sell_pct[i] > buy_pct[i]:
                consensus_signals.append((i, 'SELL', sell_pct[i], highs[i]))
        
        # Sort by index
        consensus_signals.sort(key=lambda x: x[0])
        
        # Ensure alternating pattern for final output
        if consensus_signals:
            alternating = [consensus_signals[0]]
            for sig in consensus_signals[1:]:
                if sig[1] != alternating[-1][1]:
                    alternating.append(sig)
                else:
                    # Same type - keep higher confidence
                    if sig[2] > alternating[-1][2]:
                        alternating[-1] = sig
            consensus_signals = alternating
        
        # Apply final significance filter (5% minimum move)
        if len(consensus_signals) > 1:
            significant = [consensus_signals[0]]
            for sig in consensus_signals[1:]:
                prev_price = significant[-1][3]
                move_pct = abs(sig[3] - prev_price) / prev_price
                if move_pct >= 0.05:
                    significant.append(sig)
                else:
                    # Keep higher confidence
                    if sig[2] > significant[-1][2]:
                        significant[-1] = sig
            consensus_signals = significant
        
        # Re-ensure alternating after significance filter
        if len(consensus_signals) > 1:
            final_alt = [consensus_signals[0]]
            for sig in consensus_signals[1:]:
                if sig[1] != final_alt[-1][1]:
                    final_alt.append(sig)
                else:
                    if sig[2] > final_alt[-1][2]:
                        final_alt[-1] = sig
            consensus_signals = final_alt
        
        # ------------------------------------------------------------
        # CONVERT CONSENSUS SIGNALS TO OUTPUT FORMAT
        # ------------------------------------------------------------
        signals = []
        
        for idx, signal_type, confidence, price in consensus_signals:
            timestamp = int(df.index[idx].timestamp() * 1000)
            rsi_val = float(rsi[idx]) if idx < len(rsi) and not np.isnan(rsi[idx]) else 50
            
            # Strength based on consensus confidence (0-100)
            # confidence is already 0-100 (percentage of iterations that agreed)
            strength = min(100, int(confidence * 2))  # Scale up since max is ~50%
            
            signals.append({
                'timestamp': timestamp,
                'price': float(price),
                'signal': signal_type,
                'rsi': rsi_val,
                'strength': strength,
                'confidence': round(confidence, 1),  # % of iterations that agreed
                'score': strength
            })
        
        # ------------------------------------------------------------
        # ADD HOLD SIGNALS FOR EXTENDED CONSOLIDATION PERIODS
        # ------------------------------------------------------------
        final_signals = []
        
        for i, signal in enumerate(signals):
            final_signals.append(signal)
            
            # Check for extended consolidation between signals
            if i < len(signals) - 1:
                current_idx = None
                next_idx = None
                
                for j in range(len(df.index)):
                    ts_ms = int(df.index[j].timestamp() * 1000)
                    if ts_ms == signal['timestamp']:
                        current_idx = j
                    if ts_ms == signals[i + 1]['timestamp']:
                        next_idx = j
                    if current_idx is not None and next_idx is not None:
                        break
                
                if current_idx is not None and next_idx is not None:
                    gap_bars = next_idx - current_idx
                    
                    # Only add HOLD for significant gaps (>12 bars)
                    if gap_bars >= 12:
                        mid_idx = (current_idx + next_idx) // 2
                        
                        # Check if choppy in the middle
                        choppy_at_mid, range_pct = is_choppy(mid_idx, window=6)
                        overall_move = abs(signals[i+1]['price'] - signal['price']) / signal['price']
                        
                        if choppy_at_mid or (range_pct < 0.04 and overall_move < 0.05):
                            hold_ts = int(df.index[mid_idx].timestamp() * 1000)
                            hold_rsi = float(rsi[mid_idx]) if mid_idx < len(rsi) and not np.isnan(rsi[mid_idx]) else 50
                            
                            final_signals.append({
                                'timestamp': hold_ts,
                                'price': float(closes[mid_idx]),
                                'signal': 'HOLD',
                                'rsi': hold_rsi,
                                'strength': 50,
                                'confidence': 0,
                                'score': 50
                            })
        
        # Sort by timestamp
        final_signals.sort(key=lambda x: x['timestamp'])
        
        # Remove consecutive duplicate signal types
        if len(final_signals) > 1:
            deduped = [final_signals[0]]
            for sig in final_signals[1:]:
                if sig['signal'] != deduped[-1]['signal']:
                    deduped.append(sig)
            final_signals = deduped
        
        return {
            'signals': final_signals,
            'error': None
        }
        
    except Exception as e:
        print(f"Error calculating historical signals for {ticker}: {e}")
        import traceback
        traceback.print_exc()
        return {'signals': [], 'error': str(e)}


if __name__ == '__main__':
    main()
