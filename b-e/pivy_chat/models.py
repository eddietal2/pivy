from django.db import models


class ChatDay(models.Model):
    date = models.DateField(unique=True, help_text="Trading date for this chat thread")
    title = models.CharField(max_length=120, blank=True, default='', help_text="AI-generated summary title for this day")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return str(self.date)


class ChatMessage(models.Model):
    SENDER_CHOICES = [
        ('ai', 'AI'),
        ('user', 'User'),
    ]

    MESSAGE_TYPE_CHOICES = [
        ('morning_brief', 'Morning Brief'),
        ('intraday_alert', 'Intraday Alert'),
        ('personalized_insert', 'Personalized Insert'),
        ('user_message', 'User Message'),
        ('ai_response', 'AI Response'),
    ]

    chat_day = models.ForeignKey(ChatDay, on_delete=models.CASCADE, related_name='messages')
    sender = models.CharField(max_length=10, choices=SENDER_CHOICES)
    message_type = models.CharField(max_length=25, choices=MESSAGE_TYPE_CHOICES)
    content = models.TextField()
    # null = global message visible to all users; set = only visible to that user
    user = models.ForeignKey(
        'authentication.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='pivy_chat_messages',
    )
    # Stores alert context, e.g. {"symbol": "AAPL", "move": -3.2, "trigger": "watchlist"}
    trigger = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        user_label = self.user.username if self.user else 'global'
        return f"[{self.chat_day.date}] {self.message_type} ({user_label})"
