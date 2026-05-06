"""
Management command to generate morning briefs for past dates (dev/testing only).

Usage:
    # Generate for a specific date
    python manage.py generate_backfill_briefs --date 2026-04-28

    # Generate for all weekdays in a date range
    python manage.py generate_backfill_briefs --from 2026-04-27 --to 2026-05-01

    # Generate for the previous full week (Mon–Fri)
    python manage.py generate_backfill_briefs --previous-week
"""
import logging
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger(__name__)


def _previous_week_range():
    """Return (monday, friday) of the most recent completed Mon–Fri week."""
    today = date.today()
    # Go back to last Monday
    days_since_monday = today.weekday()  # 0=Mon
    last_monday = today - timedelta(days=days_since_monday + 7)
    last_friday = last_monday + timedelta(days=4)
    return last_monday, last_friday


def _weekdays_between(start: date, end: date):
    """Yield each weekday (Mon–Fri) between start and end inclusive."""
    current = start
    while current <= end:
        if current.weekday() < 5:  # 0–4 = Mon–Fri
            yield current
        current += timedelta(days=1)


def _generate_brief_for_date(target_date: date, stdout=None):
    """
    Generate a morning brief for a specific past date.
    Reuses the same logic as generate_morning_brief_task but with an injected date.
    """
    from pivy_chat.models import ChatDay, ChatMessage
    from pivy_chat.services import YahooFinanceNewsService, PivyChatAgent
    from pivy_chat.services.economic_calendar import EconomicCalendarService

    chat_day, created = ChatDay.objects.get_or_create(date=target_date)

    if not created and chat_day.messages.filter(message_type='morning_brief').exists():
        if stdout:
            stdout.write(f'  Brief already exists for {target_date} — skipping.')
        return False

    try:
        news_svc = YahooFinanceNewsService()
        llm = PivyChatAgent()
        cal_svc = EconomicCalendarService()

        news = news_svc.get_market_news()
        earnings = news_svc.get_earnings_today()
        economic_events = cal_svc.get_events_for_date(target_date)

        index_symbols = ['^GSPC', '^DJI', '^IXIC']
        index_data = [
            {**r, 'name': {'^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'Nasdaq'}.get(r['symbol'], r['symbol'])}
            for sym in index_symbols
            if (r := news_svc.get_price_change(sym)) is not None
        ]

        content = llm.generate_morning_brief(news, earnings, index_data, economic_events)

        ChatMessage.objects.create(
            chat_day=chat_day,
            sender='ai',
            message_type='morning_brief',
            content=content,
            user=None,
            trigger={'source': 'backfill', 'target_date': str(target_date)},
        )

        try:
            title = llm.generate_day_title(content)
            chat_day.title = title
            chat_day.save(update_fields=['title'])
        except Exception as te:
            logger.warning('Title generation failed for %s: %s', target_date, te)

        if stdout:
            stdout.write(f'  ✓ Brief generated for {target_date}')
        return True

    except Exception as e:
        if stdout:
            stdout.write(f'  ✗ Failed for {target_date}: {e}')
        logger.error('Backfill failed for %s: %s', target_date, e, exc_info=True)
        return False


class Command(BaseCommand):
    help = 'Backfill morning briefs for past dates (dev use).'

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument(
            '--date',
            type=str,
            help='Single date to generate a brief for (YYYY-MM-DD).',
        )
        group.add_argument(
            '--from',
            dest='date_from',
            type=str,
            help='Start of date range (YYYY-MM-DD). Use with --to.',
        )
        group.add_argument(
            '--previous-week',
            action='store_true',
            help='Generate briefs for all weekdays in the previous Mon–Fri week.',
        )
        parser.add_argument(
            '--to',
            dest='date_to',
            type=str,
            help='End of date range (YYYY-MM-DD). Use with --from.',
        )

    def handle(self, *args, **options):
        if options['previous_week']:
            start, end = _previous_week_range()
            self.stdout.write(f'Backfilling previous week: {start} to {end}')
            dates = list(_weekdays_between(start, end))

        elif options['date']:
            try:
                dates = [date.fromisoformat(options['date'])]
            except ValueError:
                raise CommandError(f"Invalid date format: {options['date']}. Use YYYY-MM-DD.")

        elif options['date_from']:
            if not options['date_to']:
                raise CommandError('--to is required when using --from.')
            try:
                start = date.fromisoformat(options['date_from'])
                end = date.fromisoformat(options['date_to'])
            except ValueError as e:
                raise CommandError(f'Invalid date format: {e}')
            if start > end:
                raise CommandError('--from must be before --to.')
            dates = list(_weekdays_between(start, end))
        else:
            raise CommandError('No valid option provided.')

        self.stdout.write(f'Generating briefs for {len(dates)} date(s)...')
        success, skipped, failed = 0, 0, 0

        for d in dates:
            if d >= date.today():
                self.stdout.write(self.style.WARNING(f'  Skipping {d} (not a past date)'))
                skipped += 1
                continue
            result = _generate_brief_for_date(d, self.stdout)
            if result is True:
                success += 1
            elif result is False:
                # Could be skipped (already exists) or failed — check log
                failed += 1

        self.stdout.write(self.style.SUCCESS(
            f'\nDone. Generated: {success}, Skipped/existing: {skipped}, Failed: {failed}'
        ))
