import json
from datetime import date

from django.db.models import Q, Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from django.contrib.auth import get_user_model
from authentication.models import User as AuthUser
from .models import ChatDay, ChatMessage


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

    # Enqueue AI reply (non-blocking)
    try:
        from .tasks import generate_ai_reply_task
        generate_ai_reply_task.delay(
            chat_day_id=chat_day.pk,
            user_id=user.pk,
            user_message_id=user_msg.pk,
        )
    except Exception:
        # If Celery is unavailable (dev without worker), silently skip
        pass

    return _json({'message': _serialize_message(user_msg)}, status=201)


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

    return _json({'message': _serialize_message(msg)})


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
