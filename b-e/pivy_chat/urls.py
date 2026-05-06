from django.urls import path
from . import views

urlpatterns = [
    path('days/', views.days_view, name='pivy_chat_days'),
    path('messages/', views.messages_view, name='pivy_chat_messages'),
    path('messages/latest/', views.latest_message_view, name='pivy_chat_latest'),
    path('market-snapshot/', views.market_snapshot_view, name='pivy_chat_market_snapshot'),
]
