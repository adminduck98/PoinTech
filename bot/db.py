"""
Модуль работы с базой данных (Supabase).
Таблица bot_users хранит chat_id всех пользователей, написавших боту.
"""

import logging
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger(__name__)

_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def save_user(chat_id: int, first_name: str, username: str | None = None) -> None:
    """Сохранить пользователя (upsert — без дубликатов)."""
    try:
        _client.table("bot_users").upsert(
            {
                "chat_id": chat_id,
                "first_name": first_name,
                "username": username,
                "is_blocked": False,
            },
            on_conflict="chat_id",
        ).execute()
    except Exception as e:
        logger.error("Failed to save user %d: %s", chat_id, e)


def get_all_chat_ids() -> list[int]:
    """Получить все chat_id активных (не заблокировавших бот) пользователей."""
    try:
        response = (
            _client.table("bot_users")
            .select("chat_id")
            .eq("is_blocked", False)
            .execute()
        )
        return [row["chat_id"] for row in response.data]
    except Exception as e:
        logger.error("Failed to get chat IDs: %s", e)
        return []


def mark_blocked(chat_id: int) -> None:
    """Пометить пользователя как заблокировавшего бот."""
    try:
        _client.table("bot_users").update({"is_blocked": True}).eq(
            "chat_id", chat_id
        ).execute()
    except Exception as e:
        logger.error("Failed to mark user %d as blocked: %s", chat_id, e)


def get_user_count() -> int:
    """Общее количество активных пользователей."""
    try:
        response = (
            _client.table("bot_users")
            .select("chat_id", count="exact")
            .eq("is_blocked", False)
            .execute()
        )
        return response.count or 0
    except Exception as e:
        logger.error("Failed to get user count: %s", e)
        return 0


def get_user_orders(telegram_user_id: int, limit: int = 5) -> list[dict]:
    """Получить последние заказы пользователя (без доставленных и отменённых)."""
    try:
        response = (
            _client.table("orders")
            .select("id, status, total_amount, created_at, items, payment_method, delivery_type")
            .eq("telegram_user_id", telegram_user_id)
            .not_.in_("status", ["delivered", "cancelled", "returned"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.error("Failed to get orders for user %d: %s", telegram_user_id, e)
        return []


def get_user_favorites(telegram_user_id: int) -> list[dict]:
    """Получить избранные товары пользователя с данными о товаре."""
    try:
        response = (
            _client.table("favorites")
            .select("product_id, notify_price, notify_stock, products(id, name, slug, price, images, stock)")
            .eq("telegram_user_id", telegram_user_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        favorites = []
        for row in response.data or []:
            product = row.get("products")
            if product:
                favorites.append({
                    **product,
                    "notify_price": row.get("notify_price", False),
                    "notify_stock": row.get("notify_stock", False),
                })
        return favorites
    except Exception as e:
        logger.error("Failed to get favorites for user %d: %s", telegram_user_id, e)
        return []


def get_product_by_slug(slug: str) -> dict | None:
    """Получить товар по slug."""
    try:
        response = (
            _client.table("products")
            .select("id, name, slug, price, images, description, stock, is_active")
            .eq("slug", slug)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        # maybe_single() returns None — not a response object — when nothing
        # matches, so reading .data raised AttributeError and the generic
        # handler below logged it as a failure. A miss is an ordinary outcome
        # here (a stale deep link, an unknown chat), and logging it as an error
        # buries real failures in noise on a bot that logs to one file.
        return response.data if response is not None else None
    except Exception as e:
        logger.error("Failed to get product by slug %s: %s", slug, e)
        return None


def get_user_by_chat_id(chat_id: int) -> dict | None:
    """Получить пользователя bot_users по chat_id."""
    try:
        response = (
            _client.table("bot_users")
            .select("*")
            .eq("chat_id", chat_id)
            .maybe_single()
            .execute()
        )
        return response.data if response is not None else None
    except Exception as e:
        logger.error("Failed to get user by chat_id %d: %s", chat_id, e)
        return None


def get_total_orders_count() -> int:
    """Общее количество заказов."""
    try:
        response = (
            _client.table("orders")
            .select("id", count="exact")
            .execute()
        )
        return response.count or 0
    except Exception as e:
        logger.error("Failed to get orders count: %s", e)
        return 0


def get_pending_returns_count() -> int:
    """Количество заявок на возврат в статусе pending."""
    try:
        response = (
            _client.table("returns")
            .select("id", count="exact")
            .eq("status", "pending")
            .execute()
        )
        return response.count or 0
    except Exception as e:
        logger.error("Failed to get returns count: %s", e)
        return 0


def get_unread_messages_count() -> int:
    """Количество непрочитанных сообщений от пользователей."""
    try:
        response = (
            _client.table("messages")
            .select("id", count="exact")
            .eq("sender_type", "customer")
            .eq("is_read", False)
            .execute()
        )
        return response.count or 0
    except Exception as e:
        logger.error("Failed to get unread messages count: %s", e)
        return 0
