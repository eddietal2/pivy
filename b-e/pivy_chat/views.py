import json
import logging
from datetime import date

from django.db.models import Q, Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from django.contrib.auth import get_user_model
from authentication.models import User as AuthUser
from .models import ChatDay, ChatMessage

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
#  Auth + CORS helpers (matches existing paper_trading pattern)       #
# ------------------------------------------------------------------ #

def _cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
    }


def _json(data, status=200):
    resp = JsonResponse(data, status=status)
    for k, v in _cors_headers().items():
        resp[k] = v
    return resp


def _options():
    resp = JsonResponse({})
    for k, v in _cors_headers().items():
        resp[k] = v
    return resp


def _get_user(request):
    """Extract user from cookie or X-User-Email header."""
    email = request.COOKIES.get('user_email') or request.headers.get('X-User-Email')
    if not email:
        return None
    try:
        return AuthUser.objects.get(email=email, is_deleted=False)
    except AuthUser.DoesNotExist:
        return None


# ------------------------------------------------------------------ #
#  Endpoint: GET /api/pivy-chat/days/                                  #
# ------------------------------------------------------------------ #

@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def days_view(request):
    """
    List all ChatDay records, newest first.
    Returns preview (first 120 chars of morning brief) and message count.
    Auth optional — anonymous users see the list but not user-specific messages.
    """
    if request.method == 'OPTIONS':
        return _options()

    days = (
        ChatDay.objects
        .annotate(message_count=Count('messages'))
        .order_by('-date')[:30]
    )

    result = []
    for day in days:
        # Get the morning brief for the preview (global, no user filter needed)
        brief = day.messages.filter(message_type='morning_brief').first()
        preview = (brief.content[:120] + '…') if brief and len(brief.content) > 120 else (brief.content if brief else '')

        # Lazily generate title for existing records that predate the title field
        title = day.title
        if not title and brief:
            try:
                from pivy_chat.services import PivyChatAgent
                llm = PivyChatAgent()
                title = llm.generate_day_title(brief.content)
                day.title = title
                day.save(update_fields=['title'])
            except Exception:
                title = ''

        result.append({
            'date': day.date.isoformat(),
            'message_count': day.message_count,
            'preview': preview,
            'title': title,
            'has_brief': brief is not None,
        })

    return _json({'days': result})


# ------------------------------------------------------------------ #
#  Endpoint: GET  /api/pivy-chat/messages/?date=YYYY-MM-DD            #
#            POST /api/pivy-chat/messages/                            #
# ------------------------------------------------------------------ #

@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def messages_view(request):
    if request.method == 'OPTIONS':
        return _options()

    if request.method == 'GET':
        return _get_messages(request)
    return _post_message(request)


def _get_messages(request):
    """
    Return all messages for a given date, filtered to:
      - global messages (user=None)
      - messages belonging to the authenticated user
    Query param: ?date=YYYY-MM-DD  (defaults to today)
    Also triggers lazy personalized insert generation if needed.
    """
    date_str = request.GET.get('date', date.today().isoformat())
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        return _json({'error': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

    try:
        chat_day = ChatDay.objects.get(date=target_date)
    except ChatDay.DoesNotExist:
        return _json({'messages': [], 'date': date_str, 'pending_personalization': False})

    user = _get_user(request)

    # Base queryset: global messages + user-specific messages
    qs = chat_day.messages.filter(
        Q(user__isnull=True) | Q(user=user) if user else Q(user__isnull=True)
    ).order_by('created_at')

    pending_personalization = False

    # Phase 6 hook: trigger personalized insert if user is logged in and none exists today
    if user:
        has_insert = chat_day.messages.filter(
            message_type='personalized_insert', user=user
        ).exists()
        if not has_insert:
            _trigger_personalized_insert(chat_day, user)
            pending_personalization = True

    messages = [_serialize_message(m) for m in qs]

    return _json({
        'date': date_str,
        'title': chat_day.title,
        'messages': messages,
        'pending_personalization': pending_personalization,
    })


def _post_message(request):
    """
    Send a user message and enqueue an AI reply.
    Body JSON: { "date": "YYYY-MM-DD", "content": "..." }
    Requires authentication.
    """
    user = _get_user(request)
    if not user:
        return _json({'error': 'Authentication required.'}, status=401)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return _json({'error': 'Invalid JSON body.'}, status=400)

    content = (body.get('content') or '').strip()
    if not content:
        return _json({'error': 'Message content is required.'}, status=400)

    date_str = body.get('date', date.today().isoformat())
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        return _json({'error': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

    chat_day, _ = ChatDay.objects.get_or_create(date=target_date)

    # Save user message
    user_msg = ChatMessage.objects.create(
        chat_day=chat_day,
        sender='user',
        message_type='user_message',
        content=content,
        user=user,
    )

    # Enqueue AI reply (non-blocking Celery task)
    celery_ok = False
    try:
        from .tasks import generate_ai_reply_task
        generate_ai_reply_task.delay(
            chat_day_id=chat_day.pk,
            user_id=user.pk,
            user_message_id=user_msg.pk,
        )
        celery_ok = True
    except Exception:
        pass

    # Synchronous fallback when Celery worker is not running
    ai_msg = None
    if not celery_ok:
        try:
            from .tasks import generate_ai_reply_task
            generate_ai_reply_task(
                chat_day_id=chat_day.pk,
                user_id=user.pk,
                user_message_id=user_msg.pk,
            )
            # Fetch the AI message just created
            ai_msg = chat_day.messages.filter(
                sender='ai',
                message_type='ai_response',
                user=user,
            ).order_by('-created_at').first()
        except Exception as e:
            logger.warning('Synchronous AI reply failed: %s', e)

    messages_out = [_serialize_message(user_msg)]
    if ai_msg:
        messages_out.append(_serialize_message(ai_msg))

    return _json({'messages': messages_out}, status=201)


# ------------------------------------------------------------------ #
#  Endpoint: GET /api/pivy-chat/messages/latest/                      #
# ------------------------------------------------------------------ #

@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def latest_message_view(request):
    """Return the most recent global message (user=None), for the home page card."""
    if request.method == 'OPTIONS':
        return _options()

    msg = (
        ChatMessage.objects
        .filter(user__isnull=True)
        .order_by('-created_at')
        .first()
    )

    if not msg:
        return _json({'message': None})

    return _json({
        'message': _serialize_message(msg),
        'day_title': msg.chat_day.title,
    })


# ------------------------------------------------------------------ #
#  Internal helpers                                                   #
# ------------------------------------------------------------------ #

def _serialize_message(msg: ChatMessage) -> dict:
    return {
        'id': msg.pk,
        'sender': msg.sender,
        'message_type': msg.message_type,
        'content': msg.content,
        'user_id': msg.user_id,
        'trigger': msg.trigger,
        'created_at': msg.created_at.isoformat(),
    }


def _trigger_personalized_insert(chat_day: ChatDay, user):
    """
    Fire-and-forget: ask Celery to generate a personalized watchlist insert.
    Only runs if one doesn't already exist for this user+day.
    Silently skips if Celery is unavailable.
    """
    from .tasks import generate_personalized_insert_task
    try:
        generate_personalized_insert_task.delay(
            chat_day_id=chat_day.pk,
            user_id=user.pk,
        )
    except Exception:
        pass


# ------------------------------------------------------------------ #
#  Endpoint: GET /api/pivy-chat/market-snapshot/                      #
# ------------------------------------------------------------------ #

# Curated large-cap universe used for computing top movers
_MOVERS_UNIVERSE = [
    # Mega-cap tech
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'NFLX',
    'AMD', 'INTC', 'QCOM', 'AVGO', 'TXN', 'MU', 'AMAT', 'LRCX', 'KLAC', 'ADI', 'MRVL',
    # Software / cloud
    'CRM', 'NOW', 'ORCL', 'SAP', 'ADBE', 'INTU', 'WDAY', 'TEAM', 'ZM',
    'DOCU', 'OKTA', 'DDOG', 'NET', 'FSLY', 'CFLT', 'MDB', 'ESTC',
    # High-volatility growth / fintech
    'PLTR', 'SNOW', 'UBER', 'LYFT', 'RBLX', 'HOOD', 'COIN', 'MSTR',
    'SHOP', 'SQ', 'PYPL', 'SOFI', 'AFRM', 'UPST', 'LC', 'NU',
    # AI / quantum / semiconductors
    'ARM', 'SMCI', 'IONQ', 'RGTI', 'QUBT', 'BBAI', 'AI', 'SOUN', 'CRWD', 'S',
    # Meme / retail favorites
    'GME', 'AMC', 'BB', 'NOK', 'SPCE', 'NKLA',
    # EV / clean energy
    'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'FSR', 'CHPT', 'BLNK', 'PLUG', 'FCEL',
    'ENPH', 'SEDG', 'RUN', 'BE',
    # Biotech / pharma (highly volatile)
    'MRNA', 'BNTX', 'NVAX', 'BIIB', 'GILD', 'REGN', 'VRTX', 'ILMN',
    'AMGN', 'ABBV', 'LLY', 'PFE', 'JNJ', 'MRK', 'BMY', 'EXAS', 'PACB',
    'INCY', 'SGEN', 'ACAD', 'SAGE', 'FATE', 'BEAM', 'EDIT', 'CRSP',
    # Financials
    'JPM', 'GS', 'BAC', 'V', 'MA', 'C', 'WFC', 'MS', 'AXP',
    'BLK', 'SCHW', 'COF', 'USB', 'TFC', 'ALLY', 'SYF', 'DFS',
    # Energy
    'XOM', 'CVX', 'OXY', 'SLB', 'HAL', 'COP', 'EOG', 'MPC', 'VLO', 'PSX',
    'KMI', 'WMB', 'ET',
    # Consumer / retail
    'WMT', 'TGT', 'COST', 'NKE', 'MCD', 'SBUX', 'HD', 'LOW',
    'TJX', 'ROST', 'DG', 'DLTR', 'LULU', 'RH', 'W',
    # Media / entertainment / streaming
    'DIS', 'PARA', 'WBD', 'FOXA', 'SPOT', 'SNAP', 'PINS', 'RDDT',
    # Industrial / defense
    'BA', 'GE', 'CAT', 'DE', 'MMM', 'HON', 'RTX', 'LMT', 'NOC', 'GD', 'HII',
    # Healthcare / insurance
    'UNH', 'CVS', 'CI', 'HUM', 'MOH', 'CNC',
    # Real estate / REITs
    'AMT', 'CCI', 'EQIX', 'PLD', 'O', 'VICI', 'SPG',
    # Chinese ADRs
    'BABA', 'JD', 'PDD', 'BIDU', 'TCOM',
    # International
    'TSM', 'ASML',
    # Leveraged / inverse ETFs (very volatile)
    'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SPXL', 'UVXY', 'VXX',
    # Broad market / sector ETFs
    'SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLE', 'XLK', 'XLV', 'XLI',
    'XLY', 'XLP', 'XLU', 'ARKK', 'ARKG', 'ARKW',
]


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def market_snapshot_view(request):
    """
    Return live price/change data for:
      - ?symbols=AAPL,TSLA  (the user's watchlist symbols, comma-separated)
      - top 3 daily gainers and top 3 daily losers from a curated universe

    Response shape:
    {
      "watchlist": [{"symbol": "AAPL", "price": "193.20", "change": 1.42}],
      "movers": {
        "gainers": [{"symbol": "NVDA", "price": "120.50", "change": 4.21}],
        "losers":  [{"symbol": "BAC",  "price": "38.10",  "change": -2.30}]
      }
    }
    """
    if request.method == 'OPTIONS':
        return _options()

    # --- Parse watchlist symbols from query param ---
    raw_symbols = request.GET.get('symbols', '')
    watchlist_symbols = [s.strip().upper() for s in raw_symbols.split(',') if s.strip()]

    # Combine into one batch fetch (deduplicated)
    all_tickers = list(dict.fromkeys(watchlist_symbols + _MOVERS_UNIVERSE))

    try:
        from financial_data.services import fetch_all_tickers_batch
        batch = fetch_all_tickers_batch(all_tickers)
    except Exception as e:
        logger.error("market_snapshot fetch failed: %s", e)
        return _json({'error': 'Failed to fetch market data.'}, status=502)

    def _extract(ticker, data):
        day = data.get('timeframes', {}).get('day', {})
        latest = day.get('latest', {})
        return {
            'symbol': ticker,
            'price': latest.get('close', '—'),
            'change': latest.get('change', 0.0),
        }

    # Build watchlist result
    watchlist_out = []
    for sym in watchlist_symbols:
        row = batch.get(sym, {})
        if not row.get('error'):
            watchlist_out.append(_extract(sym, row))

    # Build movers from universe
    universe_rows = []
    for sym in _MOVERS_UNIVERSE:
        row = batch.get(sym, {})
        if not row.get('error'):
            day = row.get('timeframes', {}).get('day', {})
            change = day.get('latest', {}).get('change', 0.0)
            universe_rows.append({'symbol': sym, 'price': day.get('latest', {}).get('close', '—'), 'change': change})

    universe_rows.sort(key=lambda r: r['change'], reverse=True)
    gainers = universe_rows[:3]
    losers = universe_rows[-3:][::-1]  # worst performers, worst-first

    return _json({
        'watchlist': watchlist_out,
        'movers': {
            'gainers': gainers,
            'losers': losers,
        },
    })
