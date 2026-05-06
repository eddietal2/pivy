import os
import threading
import logging

from django.apps import AppConfig

logger = logging.getLogger(__name__)

# Tickers sent by the Market Pulse tab (must match MARKET_PULSE_TICKERS in the frontend)
_WARMUP_TICKERS = [
    '^GSPC', '^DJI', '^IXIC', '^VIX', 'DGS10', 'BTC-USD', 'GC=F', 'SI=F',
    'CL=F', '^RUT', 'DGS2', 'ETH-USD', 'HG=F', 'NG=F', 'CALL/PUT Ratio',
    'SOL-USD', 'XRP-USD', 'CRYPTO-FEAR-GREED', 'LIT', 'PL=F', 'PA=F',
    'TAN', 'ICLN', 'HYDR',
]


def _warmup_cache():
    """Pre-warm the market data cache in a background thread on server startup."""
    try:
        from financial_data.services import fetch_all_tickers_batch
        logger.info("Market data cache warm-up started...")
        fetch_all_tickers_batch(_WARMUP_TICKERS)
        logger.info("Market data cache warm-up complete.")
    except Exception as exc:
        logger.warning("Market data cache warm-up failed: %s", exc)


class FinancialDataConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'financial_data'

    def ready(self):
        # Only warm up in the main process (skip the autoreloader subprocess and test runner)
        if os.environ.get('RUN_MAIN') == 'true' or (
            os.environ.get('SERVER_SOFTWARE', '').startswith('gunicorn') or
            os.environ.get('RAILWAY_ENVIRONMENT') or
            os.environ.get('WARMUP_ON_READY')
        ):
            thread = threading.Thread(target=_warmup_cache, daemon=True)
            thread.start()
