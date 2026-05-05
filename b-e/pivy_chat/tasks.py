import logging
from celery import shared_task

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
#  Helper: get user's watchlist symbols                               #
# ------------------------------------------------------------------ #

def _get_user_symbols(user) -> list:
    """
    Return a list of ticker symbols from the user's paper trading watchlist.
    Returns an empty list if the user has no account or no watchlist items.
    """
    try:
        from paper_trading.models import Watchlist
        return list(
            Watchlist.objects
            .filter(account__user=user)
            .values_list('symbol', flat=True)
        )
    except Exception as e:
        logger.warning("Could not fetch watchlist for user %s: %s", user.id, e)
        return []


def _get_day_context(chat_day) -> str:
    """
    Build a short plain-text summary of today's market from the morning brief.
    Falls back to a generic string if no brief exists yet.
    """
    brief = chat_day.messages.filter(message_type='morning_brief').first()
    if brief:
        # First 300 chars of the brief is enough context for replies
        return brief.content[:300]
    return "Market data unavailable — refer to today's earlier messages."


# ------------------------------------------------------------------ #
#  Task 1: Morning brief (runs at 8:30 AM ET / 13:30 UTC weekdays)   #
#  Example: .venv\Scripts\python.exe manage.py run_pivy_task morning_brief
# ------------------------------------------------------------------ #

@shared_task(name='pivy_chat.generate_morning_brief')
def generate_morning_brief_task():
    """
    Fetch today's market news and earnings, generate a morning brief via
    Gemini, and save it as a global ChatMessage (user=None).
    Scheduled via CELERY_BEAT_SCHEDULE at 13:30 UTC Mon–Fri.
    """
    from datetime import date
    from pivy_chat.models import ChatDay, ChatMessage
    from pivy_chat.services import YahooFinanceNewsService, PivyChatAgent
    from pivy_chat.services.price_monitor import PriceMonitorService

    logger.info("Starting morning brief generation")

    today = date.today()
    chat_day, created = ChatDay.objects.get_or_create(date=today)

    # Avoid re-generating if one already exists for today
    if not created and chat_day.messages.filter(message_type='morning_brief').exists():
        logger.info("Morning brief already exists for %s — skipping", today)
        return

    try:
        news_svc = YahooFinanceNewsService()
        monitor = PriceMonitorService()
        llm = PivyChatAgent()

        news = news_svc.get_market_news()
        earnings = news_svc.get_earnings_today()

        # Get pre-market index snapshot (SPY, QQQ, DIA as proxies)
        index_symbols = ['^GSPC', '^DJI', '^IXIC']
        index_data = [
            {**r, 'name': {'^ GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'Nasdaq'}.get(r['symbol'], r['symbol'])}
            for sym in index_symbols
            if (r := news_svc.get_price_change(sym)) is not None
        ]

        content = llm.generate_morning_brief(news, earnings, index_data)

        ChatMessage.objects.create(
            chat_day=chat_day,
            sender='ai',
            message_type='morning_brief',
            content=content,
            user=None,  # global — visible to all users
            trigger={'source': 'scheduled', 'news_count': len(news), 'earnings_count': len(earnings)},
        )

        # Generate a short title for the day from the brief
        try:
            title = llm.generate_day_title(content)
            chat_day.title = title
            chat_day.save(update_fields=['title'])
            logger.info("Day title generated for %s: %s", today, title)
        except Exception as te:
            logger.warning("Title generation failed for %s: %s", today, te)

        logger.info("Morning brief saved for %s (%d news, %d earnings)", today, len(news), len(earnings))

    except Exception as e:
        logger.error("Morning brief generation failed: %s", e, exc_info=True)


# ------------------------------------------------------------------ #
#  Task 2: Intraday monitor (every 30 min, 9:30 AM–4 PM ET)          #
# ------------------------------------------------------------------ #

@shared_task(name='pivy_chat.monitor_intraday_alerts')
def monitor_intraday_alerts_task():
    """
    Check for significant market events and post intraday alert messages.

    Global alerts (user=None):
    - Major index move > 1.5% from open

    Per-user alerts (user=<user>):
    - Any watchlist stock move > 3% from open

    Avoids duplicate alerts: checks whether an identical trigger was already
    posted in the last 2 hours before saving.
    """
    from datetime import date, datetime, timezone, timedelta
    from authentication.models import User
    from pivy_chat.models import ChatDay, ChatMessage
    from pivy_chat.services import PivyChatAgent
    from pivy_chat.services.price_monitor import PriceMonitorService

    logger.info("Running intraday alert monitor")

    today = date.today()
    try:
        chat_day = ChatDay.objects.get(date=today)
    except ChatDay.DoesNotExist:
        logger.warning("No ChatDay for %s — morning brief may not have run yet", today)
        return

    llm = PivyChatAgent()
    monitor = PriceMonitorService()
    now = datetime.now(tz=timezone.utc)
    dedup_window = now - timedelta(hours=2)

    # ---- Global: index moves ----------------------------------------
    for index in monitor.check_index_moves():
        symbol = index['symbol']
        # Skip if we already alerted on this index today within 2 hours
        already_alerted = chat_day.messages.filter(
            message_type='intraday_alert',
            user=None,
            trigger__symbol=symbol,
            created_at__gte=dedup_window,
        ).exists()
        if already_alerted:
            continue

        content = llm.generate_intraday_alert(
            trigger_type='index_move',
            context={
                'name': index.get('name', symbol),
                'symbol': symbol,
                'change_pct': f"{index['change_pct']:+.2f}%",
                'direction': index['direction'],
                'current_price': index['current_price'],
            },
        )
        ChatMessage.objects.create(
            chat_day=chat_day,
            sender='ai',
            message_type='intraday_alert',
            content=content,
            user=None,
            trigger=index,
        )
        logger.info("Global index alert saved: %s %+.2f%%", symbol, index['change_pct'])

    # ---- Per-user: watchlist moves ----------------------------------
    for user in User.objects.filter(is_deleted=False):
        symbols = _get_user_symbols(user)
        if not symbols:
            continue

        for hit in monitor.check_watchlist_moves(symbols):
            symbol = hit['symbol']
            already_alerted = chat_day.messages.filter(
                message_type='intraday_alert',
                user=user,
                trigger__symbol=symbol,
                created_at__gte=dedup_window,
            ).exists()
            if already_alerted:
                continue

            content = llm.generate_intraday_alert(
                trigger_type='watchlist_move',
                context={
                    'symbol': symbol,
                    'change_pct': f"{hit['change_pct']:+.2f}%",
                    'direction': hit['direction'],
                    'current_price': hit['current_price'],
                    'user_watchlist': ', '.join(symbols),
                },
            )
            ChatMessage.objects.create(
                chat_day=chat_day,
                sender='ai',
                message_type='intraday_alert',
                content=content,
                user=user,
                trigger=hit,
            )
            logger.info(
                "Watchlist alert saved for user %s: %s %+.2f%%",
                user.id, symbol, hit['change_pct']
            )


# ------------------------------------------------------------------ #
#  Task 3: AI reply (triggered immediately when user sends a message) #
# ------------------------------------------------------------------ #

@shared_task(name='pivy_chat.generate_ai_reply')
def generate_ai_reply_task(chat_day_id: int, user_id: int, user_message_id: int):
    """
    Generate an AI response to a user's message and save it as a ChatMessage.

    Args:
        chat_day_id:     PK of the ChatDay this reply belongs to.
        user_id:         PK of the user who sent the message.
        user_message_id: PK of the user's ChatMessage to reply to.
    """
    from authentication.models import User
    from pivy_chat.models import ChatDay, ChatMessage
    from pivy_chat.services import PivyChatAgent

    try:
        chat_day = ChatDay.objects.get(pk=chat_day_id)
        user = User.objects.get(pk=user_id)
        user_message = ChatMessage.objects.get(pk=user_message_id)
    except Exception as e:
        logger.error("generate_ai_reply_task: could not load objects: %s", e)
        return

    try:
        llm = PivyChatAgent()

        # Build conversation history visible to this user: global + their own messages
        from django.db.models import Q
        history_qs = chat_day.messages.filter(
            Q(user__isnull=True) | Q(user=user)
        ).order_by('created_at')

        history = [
            {'sender': msg.sender, 'content': msg.content}
            for msg in history_qs
            if msg.pk != user_message.pk  # exclude the message we're replying to
        ]

        day_context = _get_day_context(chat_day)

        content = llm.generate_ai_reply(
            conversation_history=history,
            user_message=user_message.content,
            day_context=day_context,
        )

        ChatMessage.objects.create(
            chat_day=chat_day,
            sender='ai',
            message_type='ai_response',
            content=content,
            user=user,  # scoped to this user
            trigger={'reply_to_message_id': user_message.pk},
        )

        logger.info("AI reply saved for user %s on day %s", user.id, chat_day.date)

    except Exception as e:
        logger.error("generate_ai_reply_task failed: %s", e, exc_info=True)


# ------------------------------------------------------------------ #
#  Task 4: Personalized insert (triggered lazily on first GET)        #
# ------------------------------------------------------------------ #

@shared_task(name='pivy_chat.generate_personalized_insert')
def generate_personalized_insert_task(chat_day_id: int, user_id: int):
    """
    Generate a short personalized watchlist note for a user and save it.
    Called lazily the first time a user loads a chat day without one.
    Idempotent: skips if one already exists for this user+day.
    """
    from authentication.models import User
    from pivy_chat.models import ChatDay, ChatMessage
    from pivy_chat.services import YahooFinanceNewsService, PivyChatAgent

    try:
        chat_day = ChatDay.objects.get(pk=chat_day_id)
        user = User.objects.get(pk=user_id)
    except Exception as e:
        logger.error("generate_personalized_insert_task: could not load objects: %s", e)
        return

    # Idempotency guard
    if chat_day.messages.filter(message_type='personalized_insert', user=user).exists():
        return

    symbols = _get_user_symbols(user)
    if not symbols:
        return

    try:
        news_svc = YahooFinanceNewsService()
        llm = PivyChatAgent()

        symbol_news = news_svc.get_watchlist_news(symbols)
        symbol_prices = [
            p for sym in symbols
            if (p := news_svc.get_price_change(sym)) is not None
        ]

        content = llm.generate_personalized_insert(
            user_symbols=symbols,
            symbol_news=symbol_news,
            symbol_prices=symbol_prices,
        )

        ChatMessage.objects.create(
            chat_day=chat_day,
            sender='ai',
            message_type='personalized_insert',
            content=content,
            user=user,
            trigger={'symbols': symbols},
        )

        logger.info("Personalized insert saved for user %s on day %s", user.id, chat_day.date)

    except Exception as e:
        logger.error("generate_personalized_insert_task failed: %s", e, exc_info=True)
