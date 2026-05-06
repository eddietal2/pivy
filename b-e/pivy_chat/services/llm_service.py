import logging
from os import getenv

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------ #
#  System prompt                                                       #
# ------------------------------------------------------------------ #

_SYSTEM_PROMPT = """
You are Pivy, a friendly AI market educator built into the Pivy trading app.

Your role:
- Summarise what is happening in financial markets in plain, accessible language.
- Explain financial jargon briefly when you use it (e.g. "CPI — a measure of inflation").
- Highlight meaningful events: earnings surprises, large index moves, economic data releases.
- Keep messages concise. Prefer short paragraphs or bullet points over walls of text.
- When relevant, add a short "why it matters" or "what to watch" note to help users learn.

Rules you must always follow:
- Never give personalised financial advice, buy/sell recommendations, or price targets.
- Never predict the future direction of any stock, index, or asset with certainty.
- Always include a brief disclaimer when discussing individual stocks: 
  "This is educational, not financial advice."
- If data is absent or uncertain, say so honestly — do not fabricate figures.
- Do not use excessive emojis. One or two per message maximum.
- Write in a warm, approachable tone — like a knowledgeable friend, not a Bloomberg terminal.
""".strip()

_MODEL = "gemini-2.5-flash"


# ------------------------------------------------------------------ #
#  Agent                                                               #
# ------------------------------------------------------------------ #

class PivyChatAgent:
    """
    Wraps Google Gemini 2.5 Flash to generate Pivy Chat messages.

    All methods return a plain string (the AI-generated message content).
    On any API error they return a safe fallback string so the caller
    never receives None or an exception.
    """

    def __init__(self):
        from google import genai
        api_key = getenv('GOOGLE_AI_API_KEY')
        if not api_key:
            raise EnvironmentError("GOOGLE_AI_API_KEY is not set in the environment.")
        self._client = genai.Client(api_key=api_key)

    def _generate(self, prompt: str) -> str:
        """Send a prompt to Gemini and return the text response."""
        try:
            from google.genai import types
            response = self._client.models.generate_content(
                model=_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=_SYSTEM_PROMPT,
                    temperature=0.7,
                    max_output_tokens=2048,
                ),
            )
            return response.text.strip()
        except Exception as e:
            logger.error("Gemini API error: %s", e)
            return "⚠️ Market update unavailable right now. Check back shortly."

    # ---------------------------------------------------------------- #
    #  Public methods                                                   #
    # ---------------------------------------------------------------- #

    def generate_morning_brief(
        self,
        news: list,
        earnings: list,
        index_data: list,
        economic_events: list = None,
    ) -> str:
        """
        Generate the daily 8:30 AM market brief.

        Args:
            news:             List of news dicts from YahooFinanceNewsService.get_market_news()
            earnings:         List of earnings dicts from YahooFinanceNewsService.get_earnings_today()
            index_data:       List of price dicts from PriceMonitorService (pre-market snapshot)
            economic_events:  List of event dicts from EconomicCalendarService (optional)

        Returns:
            Formatted morning brief as a string.
        """
        news_block = _format_news(news, limit=8)
        earnings_block = _format_earnings(earnings)
        index_block = _format_index_data(index_data)
        econ_block = _format_economic_events(economic_events or [])

        prompt = f"""
            Write a concise morning market brief for Pivy users. Today is a trading day.

            ## Pre-market index snapshot
            {index_block}

            ## Today's US economic calendar (key scheduled events)
            {econ_block}

            ## Companies reporting earnings today
            {earnings_block}

            ## Recent market headlines (last 12 hours)
            {news_block}

            Instructions:
            - Open with 1–2 sentences on the overall market mood.
            - Include a "📅 Today's Economic Calendar" section with bullet points listing
              each scheduled event, its time, and a one-line plain-English explanation of
              why it matters. Only include this section if there are events.
            - Summarise the most important 2–3 news items.
            - If there are notable earnings, mention them briefly.
            - Close with 1 sentence on what to watch during the trading session.
            - Keep the total response under 350 words.
            """.strip()

        return self._generate(prompt)

    def generate_personalized_insert(
        self,
        user_symbols: list,
        symbol_news: list,
        symbol_prices: list,
    ) -> str:
        """
        Generate a personalised market insert for a specific user's watchlist.

        Args:
            user_symbols:  List of ticker strings from the user's watchlist.
            symbol_news:   News items relevant to those symbols.
            symbol_prices: Price change dicts for those symbols.

        Returns:
            Short personalised market note as a string.
        """
        if not user_symbols:
            return ""

        prices_block = _format_price_list(symbol_prices)
        news_block = _format_news(symbol_news, limit=5)

        prompt = f"""
Write a short personalised market note for a user watching these stocks: {', '.join(user_symbols)}.

## Current price changes for their watchlist
{prices_block}

## Related headlines
{news_block}

Instructions:
- Mention any notable movers (up or down significantly).
- Summarise the most relevant headline for their stocks if there is one.
- Keep it under 120 words.
- End with: "This is educational, not financial advice."
""".strip()

        return self._generate(prompt)

    def generate_intraday_alert(
        self,
        trigger_type: str,
        context: dict,
    ) -> str:
        """
        Generate an intraday alert message when a significant event is detected.

        Args:
            trigger_type: One of 'index_move', 'watchlist_move', 'earnings_surprise',
                          'economic_data'.
            context:      Dict with event details. Expected keys vary by trigger_type:
                          - index_move:       {name, symbol, change_pct, direction}
                          - watchlist_move:   {symbol, change_pct, direction, user_symbols}
                          - earnings_surprise:{symbol, company_name, detail}
                          - economic_data:    {event_name, actual, expected, impact}

        Returns:
            Alert message as a string.
        """
        context_block = "\n".join(f"- {k}: {v}" for k, v in context.items())

        prompt = f"""
Write a brief intraday market alert for Pivy users.

Alert type: {trigger_type}

Event details:
{context_block}

Instructions:
- Open with what happened in one sentence (be specific with numbers).
- Add 2–3 sentences explaining why this matters and what it could signal.
- Keep an educational tone — explain any jargon used.
- Keep the total under 100 words.
- If discussing a specific stock, end with: "This is educational, not financial advice."
""".strip()

        return self._generate(prompt)

    def generate_ai_reply(
        self,
        conversation_history: list,
        user_message: str,
        day_context: str,
    ) -> str:
        """
        Generate an AI reply to a user's message within a daily chat thread.

        Args:
            conversation_history: List of {sender, content} dicts, oldest first.
                                  sender is 'ai' or 'user'.
            user_message:         The user's latest message text.
            day_context:          A short string summarising today's market (e.g.
                                  the morning brief, or a one-liner like
                                  "S&P 500 down 1.8%, CPI came in hot at 3.2%").

        Returns:
            AI reply as a string.
        """
        history_block = _format_conversation(conversation_history, limit=10)

        prompt = f"""
Today's market context: {day_context}

Recent conversation:
{history_block}

User's latest message: "{user_message}"

Instructions:
- Reply directly and helpfully to the user's question or comment.
- Use today's market context where relevant.
- Keep the response concise — under 150 words unless more depth is genuinely needed.
- If the user asks for a buy/sell recommendation or price prediction, politely decline
  and explain why, then pivot to something educational you can help with.
- Match the conversational tone of the chat — this is a dialogue, not a report.
""".strip()

        return self._generate(prompt)

    def generate_day_title(self, brief_content: str) -> str:
        """
        Generate a short, punchy title (8–12 words) summarising the day's market theme.
        Returns plain text — no markdown, no punctuation at the end.
        """
        prompt = f"""Given the following market morning brief, write a short title (8 to 12 words) that captures the key market theme of the day.

Rules:
- Plain text only — no markdown, no asterisks, no bullet points.
- No trailing period or punctuation.
- Sound like a newspaper headline, e.g. "Tech Selloff Continues as Fed Minutes Weigh on Sentiment"
- Do not start with "Today" or a date.

Morning brief:
{brief_content[:600]}

Title:""".strip()

        try:
            raw = self._generate(prompt).strip()
            # Strip any accidental markdown or quotes
            raw = raw.strip('*_"`\'')
            return raw[:120]
        except Exception:
            return "Market Brief"

def _format_economic_events(events: list) -> str:
    if not events:
        return "No high/medium-impact US economic events scheduled today."
    lines = []
    for e in events:
        time = e.get('time', '')
        event = e.get('event', '')
        actual = e.get('actual')
        estimate = e.get('estimate')
        previous = e.get('previous')
        unit = e.get('unit', '')
        impact = e.get('impact', '')

        parts = []
        if actual is not None:
            parts.append(f"Actual: {actual}{unit}")
        if estimate is not None:
            parts.append(f"Est: {estimate}{unit}")
        if previous is not None:
            parts.append(f"Prev: {previous}{unit}")

        detail = f" ({', '.join(parts)})" if parts else ''
        impact_tag = " [HIGH]" if impact == 'High' else ''
        lines.append(f"- {time}  {event}{detail}{impact_tag}")
    return "\n".join(lines)


def _format_news(news: list, limit: int = 8) -> str:
    if not news:
        return "No recent headlines available."
    lines = []
    for item in news[:limit]:
        pub = item.get('published_at', '')[:16] if item.get('published_at') else ''
        lines.append(f"- [{pub}] {item.get('title', '')} ({item.get('publisher', '')})")
    return "\n".join(lines)


def _format_earnings(earnings: list) -> str:
    if not earnings:
        return "No major earnings scheduled today."
    return "\n".join(
        f"- {e['company_name']} ({e['symbol']})" for e in earnings
    )


def _format_index_data(index_data: list) -> str:
    if not index_data:
        return "Index data not available."
    lines = []
    for idx in index_data:
        sign = "+" if idx.get('change_pct', 0) >= 0 else ""
        lines.append(
            f"- {idx.get('name', idx.get('symbol', '?'))}: "
            f"{sign}{idx.get('change_pct', 0):.2f}% "
            f"(${idx.get('current_price', '?')})"
        )
    return "\n".join(lines)


def _format_price_list(prices: list) -> str:
    if not prices:
        return "No price data available."
    lines = []
    for p in prices:
        sign = "+" if p.get('change_pct', 0) >= 0 else ""
        lines.append(
            f"- {p['symbol']}: {sign}{p.get('change_pct', 0):.2f}% "
            f"(${p.get('current_price', '?')})"
        )
    return "\n".join(lines)


def _format_conversation(history: list, limit: int = 10) -> str:
    if not history:
        return "(no prior messages)"
    recent = history[-limit:]
    lines = []
    for msg in recent:
        label = "Pivy" if msg.get('sender') == 'ai' else "User"
        lines.append(f"{label}: {msg.get('content', '').strip()}")
    return "\n".join(lines)
