"""
Point Tech — Telegram Bot.

Команды:
  /start       — Регистрация пользователя + главное меню
  /help        — Справка
  /menu        — Показать главное меню
  /orders      — Мои заказы
  /favorites   — Избранные товары
  /support     — Связаться с поддержкой
  /faq         — Часто задаваемые вопросы
  /about       — О магазине
  /reply       — Ответить пользователю (только ADMIN_ID)
  /broadcast   — Массовая рассылка (только ADMIN_ID)
  /stats       — Статистика (только ADMIN_ID)

Deep links:
  /start product_SLUG — Поделиться товаром
"""

import logging
import time
from datetime import datetime

from telegram import (
    Update,
    WebAppInfo,
    KeyboardButton,
    ReplyKeyboardMarkup,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    BotCommand,
)
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from config import (
    BOT_TOKEN,
    ADMIN_ID,
    WEBAPP_URL,
    SHOP_NAME,
    SHOP_SITE,
    SHOP_CHANNEL,
    SHOP_EMAIL,
)
import db
from broadcaster import broadcast, BroadcastResult

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)

# httpx logs every request line at INFO, and python-telegram-bot's request URLs
# embed the bot token:
#
#   HTTP Request: POST https://api.telegram.org/bot<TOKEN>/sendMessage "200 OK"
#
# With the root logger at INFO that wrote the token to bot/bot.log on every
# single API call — 6742 copies in the 1.5 MB file found in this checkout. The
# same applies to the Supabase client in db.py/broadcaster.py, whose URLs carry
# the service-role key as a query-string-free header but whose paths still leak
# table and filter details. Keep both transports at WARNING.
#
# NOTE: a token that has been written to disk in cleartext must be rotated
# through BotFather; silencing the logger only stops it happening again.
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

_support_mode: dict[int, float] = {}
SUPPORT_MODE_TTL = 3600

# Track last user who messaged admin for quick reply
_last_user: dict[int, dict] = {}


def _cleanup_support_mode() -> None:
    now = time.time()
    expired = [uid for uid, ts in _support_mode.items() if now - ts > SUPPORT_MODE_TTL]
    for uid in expired:
        _support_mode.pop(uid, None)
    if expired:
        logger.info("Cleaned up %d expired support modes", len(expired))


def main_menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            # Обычная кнопка, а не KeyboardButton(web_app=...).
            #
            # Web App, подвешенный к кнопке *reply-клавиатуры*, у части
            # клиентов не открывается по нажатию — кнопка выглядит рабочей и
            # ничего не делает. Именно поэтому она казалась сломанной, пока
            # инлайновая кнопка в /about открывала тот же самый URL.
            #
            # Как обычная кнопка нажатие всегда доходит текстом до
            # handle_any_message, а тот отвечает ровно той инлайновой кнопкой,
            # которая работает. Один и тот же WEBAPP_URL, один и тот же
            # WebAppInfo — разница только в том, что путь проверенный.
            [KeyboardButton("🛍 Открыть магазин")],
            [
                KeyboardButton("📦 Мои заказы"),
                KeyboardButton("❤️ Избранное"),
            ],
            [
                KeyboardButton("📞 Поддержка"),
                KeyboardButton("❓ FAQ"),
            ],
            [
                KeyboardButton("ℹ️ О магазине"),
            ],
        ],
        resize_keyboard=True,
    )


def open_shop_keyboard() -> InlineKeyboardMarkup:
    """
    Инлайновая кнопка, которая реально открывает Mini App.

    Повторяет кнопку из cmd_about — единственную, про которую точно известно,
    что она работает: тот же класс, тот же текст, тот же WebAppInfo из того же
    WEBAPP_URL. Сам cmd_about не тронут.
    """
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("🛒 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )


async def cmd_shop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Нижняя кнопка «🛍 Открыть магазин» из меню."""
    await update.message.reply_text(
        f"🛍 <b>{SHOP_NAME}</b>\n\nНажмите кнопку ниже — магазин откроется здесь же, в Telegram.",
        parse_mode="HTML",
        reply_markup=open_shop_keyboard(),
    )


def support_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("❌ Завершить диалог", callback_data="support_exit")]]
    )


def back_to_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("🔙 Назад в меню", callback_data="back_to_menu")]]
    )


def format_price(amount: float) -> str:
    return f'{amount:,.0f}'.replace(",", " ")


def get_localized_name(name) -> str:
    if isinstance(name, dict):
        return name.get("ru") or name.get("uz") or str(name)
    return str(name) if name else "Товар"


SUPPORTED_PHOTO_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'}


def get_first_photo(images) -> str | None:
    if not isinstance(images, list):
        return None
    for url in images:
        if not isinstance(url, str) or not url.strip():
            continue
        clean_url = url.split('?')[0]
        ext = clean_url.rsplit('.', 1)[-1].lower() if '.' in clean_url.rsplit('/', 1)[-1] else ''
        if f".{ext}" in SUPPORTED_PHOTO_EXTS:
            return url
    return None


def get_supported_photos(images) -> list[str]:
    if not isinstance(images, list):
        return []
    result = []
    for url in images:
        if not isinstance(url, str) or not url.strip():
            continue
        clean_url = url.split('?')[0]
        ext = clean_url.rsplit('.', 1)[-1].lower() if '.' in clean_url.rsplit('/', 1)[-1] else ''
        if f".{ext}" in SUPPORTED_PHOTO_EXTS:
            result.append(url)
    return result


async def send_photo_with_fallback(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    images,
    caption: str,
    reply_markup=None,
) -> bool:
    """Try sending photo from images list. Falls back to text on failure."""
    chat_id = update.effective_chat.id
    urls = get_supported_photos(images) if isinstance(images, list) else []
    if isinstance(images, str) and images.strip():
        urls = [images]

    logger.info("send_photo_with_fallback: %d candidate URLs, raw images=%s", len(urls), repr(images)[:200] if images else "None")
    for i, url in enumerate(urls):
        logger.info("send_photo_with_fallback: trying [%d/%d] %s", i + 1, len(urls), url[:150])
        try:
            await context.bot.send_photo(
                chat_id=chat_id,
                photo=url,
                caption=caption,
                parse_mode="HTML",
                reply_markup=reply_markup,
            )
            logger.info("send_photo_with_fallback: SUCCESS for %s", url[:150])
            return True
        except Exception as e:
            logger.warning("sendPhoto failed [%d/%d] %s: %s", i + 1, len(urls), url[:150], e)
            continue

    logger.warning("send_photo_with_fallback: ALL photos failed, sending text fallback")
    await context.bot.send_message(
        chat_id=chat_id,
        text=caption,
        parse_mode="HTML",
        reply_markup=reply_markup,
    )
    return False


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user:
        return

    db.save_user(
        chat_id=user.id,
        first_name=user.first_name or "",
        username=user.username,
    )

    args = context.args
    if args and args[0].startswith("product_"):
        slug = args[0][8:]
        await _show_shared_product(update, context, slug)
        return

    text = (
        f"Привет, {user.first_name}! 👋\n\n"
        f"Добро пожаловать в <b>{SHOP_NAME}</b>!\n"
        "Техника и электроника с доставкой по Узбекистану.\n\n"
        "━━━━━━━━━━━━━━━━\n\n"
        "🛍 <b>Что умеет бот:</b>\n"
        "• Каталог и оформление заказа\n"
        "• Отслеживание статуса заказов\n"
        "• Поддержка и консультации\n"
        "• Уведомления о акциях\n\n"
        "━━━━━━━━━━━━━━━━\n\n"
        "Выберите действие из меню 👇"
    )

    await update.message.reply_text(
        text, parse_mode="HTML", reply_markup=main_menu_keyboard()
    )
    logger.info("User registered: %d (%s)", user.id, user.username)


async def _show_shared_product(update: Update, context: ContextTypes.DEFAULT_TYPE, slug: str) -> None:
    product = db.get_product_by_slug(slug)
    if not product:
        await update.message.reply_text(
            "❌ Товар не найден или больше не продаётся.",
            reply_markup=main_menu_keyboard(),
        )
        return

    name = get_localized_name(product.get("name"))
    price = format_price(product.get("price", 0))
    description = ""
    if isinstance(product.get("description"), dict):
        description = product["description"].get("ru", "") or product["description"].get("uz", "")
    elif product.get("description"):
        description = str(product["description"])
    stock = product.get("stock", 0)
    stock_text = f"✅ В наличии ({stock} шт.)" if stock > 0 else "❌ Нет в наличии"
    images = product.get("images") or []
    webapp_url = f"{WEBAPP_URL}/product/{slug}"

    lines = [f"💰 <b>{price} сум</b>", f"📦 {stock_text}"]
    if description:
        desc_short = description[:300] + ("..." if len(description) > 300 else "")
        lines.append(f"\n📝 {desc_short}")

    caption = (
        f"🛍 <b>{name}</b>\n\n"
        + "\n".join(lines)
        + "\n\n━━━━━━━━━━━━━━━━"
    )

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("🛒 Открыть в каталоге", web_app=WebAppInfo(url=webapp_url))]]
    )

    await send_photo_with_fallback(update, context, images, caption, keyboard)


async def cmd_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "📋 <b>Главное меню</b>\n\n"
        "━━━━━━━━━━━━━━━━\n"
        "Выберите действие:",
        parse_mode="HTML",
        reply_markup=main_menu_keyboard(),
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        f"🛍 <b>{SHOP_NAME} — Справка</b>\n\n"
        "📋 <b>Команды:</b>\n"
        "/start — Приветствие и главное меню\n"
        "/menu — Открыть меню\n"
        "/orders — Мои заказы\n"
        "/favorites — Избранные товары\n"
        "/support — Связаться с поддержкой\n"
        "/faq — Часто задаваемые вопросы\n"
        "/about — О магазине\n"
        "/help — Эта справка\n\n"
        "━━━━━━━━━━━━━━━━\n\n"
        "🛍 <b>Магазин:</b>\n"
        "Нажмите «Открыть магазин» для каталога.\n\n"
        "📦 <b>Заказы:</b>\n"
        "Статус заказов в разделе «Мои заказы».\n\n"
        "🔔 <b>Уведомления:</b>\n"
        "О статусе заказов, скидках и акциях.\n\n"
        "💬 Вопросы? Пишите в поддержку!"
    )
    await update.message.reply_text(
        text, parse_mode="HTML", reply_markup=main_menu_keyboard()
    )


async def cmd_orders(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user:
        return

    orders = db.get_user_orders(user.id, limit=5)

    if not orders:
        text = (
            "📦 <b>Мои заказы</b>\n\n"
            "━━━━━━━━━━━━━━━━\n\n"
            "У вас пока нет заказов.\n"
            "Откройте каталог и сделайте первый заказ! 🛍"
        )
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("🛍 Открыть каталог", web_app=WebAppInfo(url=WEBAPP_URL))]]
        )
        await update.message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)
        return

    STATUS_LABELS = {
        "new": "🆕 Новый",
        "processing": "⚙️ В обработке",
        "assembling": "📦 В сборке",
        "assembled": "✅ Собран",
        "shipping": "🚚 В пути",
        "delivered": "✅ Доставлен",
        "cancelled": "❌ Отменён",
        "return_requested": "🔄 Запрос возврата",
        "returned": "↩️ Возвращён",
        "paid": "💳 Оплачен",
        "shipped": "🚚 Отправлен",
    }

    await update.message.reply_text(
        "📦 <b>Мои заказы</b>\n\nОтправляю информацию о заказах...",
        parse_mode="HTML",
    )

    for order in orders:
        short_id = order["id"][:8].upper()
        status = STATUS_LABELS.get(order["status"], order["status"])
        amount = format_price(order.get("total_amount", 0))
        date_raw = order["created_at"][:10]
        items = order.get("items") or []

        order_images = []
        item_lines = []
        for item in items[:5]:
            name = get_localized_name(item.get("name"))
            qty = item.get("quantity", 1)
            item_text = f"• {name}"
            if qty > 1:
                item_text += f" × {qty}"
            item_lines.append(item_text)
            if item.get("image"):
                order_images.append(item["image"])
        logger.info("ORDERS DEBUG: order=%s order_images=%s", short_id, repr(order_images)[:300])

        if len(items) > 5:
            item_lines.append(f"• ...и ещё {len(items) - 5}")

        items_text = "\n".join(item_lines) if item_lines else "• Нет товаров"

        caption = (
            f"📦 <b>Заказ #{short_id}</b>\n\n"
            f"{status}\n"
            f"📅 {date_raw}  •  💰 {amount} сум\n\n"
            f"{items_text}\n\n"
            f"━━━━━━━━━━━━━━━━"
        )

        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("🛒 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))]]
        )

        await send_photo_with_fallback(update, context, order_images, caption, keyboard)


async def cmd_favorites(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user:
        return

    favorites = db.get_user_favorites(user.id)

    if not favorites:
        text = (
            "❤️ <b>Избранное</b>\n\n"
            "━━━━━━━━━━━━━━━━\n\n"
            "У вас пока нет избранных товаров.\n"
            "Добавляйте товары — нажмите на сердечко ❤️"
        )
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("🛍 Открыть каталог", web_app=WebAppInfo(url=WEBAPP_URL))]]
        )
        await update.message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)
        return

    await update.message.reply_text(
        f"❤️ <b>Избранное</b> — {len(favorites)} товаров\n\nОтправляю...",
        parse_mode="HTML",
    )

    for product in favorites[:5]:
        name = get_localized_name(product.get("name"))
        price = format_price(product.get("price", 0))
        slug = product.get("slug", "")
        stock = product.get("stock", 0)
        images = product.get("images") or []
        logger.info("FAVORITES DEBUG: product=%s slug=%s images=%s", name, slug, repr(images)[:300])
        stock_text = "✅ В наличии" if stock > 0 else "❌ Нет в наличии"

        lines = [f"💰 {price} сум", f"📦 {stock_text}"]
        if product.get("notify_price"):
            lines.append("🔔 Уведомить о скидке")
        if product.get("notify_stock"):
            lines.append("🔔 Уведомить о наличии")

        caption = (
            f"❤️ <b>{name}</b>\n\n"
            + "\n".join(lines)
            + "\n\n━━━━━━━━━━━━━━━━"
        )

        webapp_url = f"{WEBAPP_URL}/product/{slug}" if slug else WEBAPP_URL
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("🛒 Открыть товар", web_app=WebAppInfo(url=webapp_url))]]
        )

        await send_photo_with_fallback(update, context, images, caption, keyboard)


async def cmd_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user:
        return

    _support_mode[user.id] = time.time()

    text = (
        "📞 <b>Служба поддержки</b>\n\n"
        "━━━━━━━━━━━━━━━━\n\n"
        "Напишите сообщение — ответим в ближайшее время.\n\n"
        "⏰ Ответ до 24 часов\n"
        "📌 Завершить диалог — кнопка ниже"
    )
    await update.message.reply_text(
        text, parse_mode="HTML", reply_markup=support_keyboard()
    )


async def cmd_faq(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "❓ <b>Часто задаваемые вопросы</b>\n\n"

        "━━━━━━━━━━━━━━━━\n\n"

        "📦 <b>Доставка</b>\n"
        "По всему Узбекистану, 1-3 дня.\n"
        "Экспресс по Ташкенту — в тот же день.\n"
        "Бесплатно при заказе от 500 000 сум.\n\n"

        "━━━━━━━━━━━━━━━━\n\n"

        "💳 <b>Оплата</b>\n"
        "Наличные • Payme • Click • Uzum Bank\n\n"

        "━━━━━━━━━━━━━━━━\n\n"

        "↩️ <b>Возврат</b>\n"
        "В течение 14 дней через «Мои заказы».\n\n"

        "━━━━━━━━━━━━━━━━\n\n"

        "⏰ <b>Сроки</b>\n"
        "Ташкент: 1-2 дня • Регионы: 2-5 дней\n\n"

        "━━━━━━━━━━━━━━━━\n\n"

        "📞 <b>Контакты</b>\n"
        "Telegram: @one_shop\n"
        "Email: info@one.uz"
    )
    await update.message.reply_text(
        text, parse_mode="HTML", reply_markup=back_to_menu_keyboard()
    )


async def cmd_about(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        f"ℹ️ <b>{SHOP_NAME}</b>\n\n"
        "Техника и электроника\n"
        "для каждого жителя Узбекистана.\n\n"
        "━━━━━━━━━━━━━━━━\n\n"
        "🎯 <b>Миссия</b>\n"
        "Оригинальные устройства по честным ценам,\n"
        "напрямую от официальных поставщиков."
    )

    # Only the routes this deployment actually has (see bot/config.py).
    links = [value for value in (SHOP_SITE, SHOP_CHANNEL, SHOP_EMAIL) if value]
    if links:
        text += "\n\n━━━━━━━━━━━━━━━━\n\n🌐 <b>Ссылки</b>\n" + "\n".join(
            f"• {link}" for link in links
        )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("🛒 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL))],
            [InlineKeyboardButton("🔙 Назад в меню", callback_data="back_to_menu")],
        ]
    )
    await update.message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)


# ─── Admin reply command ────────────────────────────────────────────────────


async def cmd_reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or user.id != ADMIN_ID:
        await update.message.reply_text("⛔ У вас нет доступа к этой команде.")
        return

    if not context.args or len(context.args) < 2:
        await update.message.reply_text(
            "Использование:\n<code>/reply USER_ID Сообщение</code>\n\n"
            "Пример: <code>/reply 123456789 Заказ отправлен!</code>",
            parse_mode="HTML",
        )
        return

    try:
        target_user_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("❌ Неверный USER_ID. Используйте числовой ID.")
        return

    reply_text = " ".join(context.args[1:])

    try:
        await context.bot.send_message(
            chat_id=target_user_id,
            text=f"💬 <b>Ответ от поддержки:</b>\n\n{reply_text}",
            parse_mode="HTML",
        )
        await update.message.reply_text(
            f"✅ Сообщение отправлено пользователю <code>{target_user_id}</code>",
            parse_mode="HTML",
        )
    except Exception as e:
        await update.message.reply_text(
            f"❌ Не удалось отправить: {e}"
        )


# ─── Callback handlers ──────────────────────────────────────────────────────


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    data = query.data

    if data == "back_to_menu":
        try:
            await query.edit_message_text(
                "📋 <b>Главное меню</b>\n\nВыберите действие:",
                parse_mode="HTML",
            )
        except Exception:
            await query.message.reply_text(
                "📋 <b>Главное меню</b>\n\nВыберите действие:",
                parse_mode="HTML",
                reply_markup=main_menu_keyboard(),
            )

    elif data == "support_exit":
        user = update.effective_user
        if user:
            _support_mode.pop(user.id, None)
        await query.edit_message_text(
            "✅ Диалог завершён.\n\n"
            "Нужна помощь? /support",
            parse_mode="HTML",
        )


# ─── Message handler ────────────────────────────────────────────────────────


async def handle_any_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return
    user = update.effective_user
    if not user:
        return

    _cleanup_support_mode()

    db.save_user(
        chat_id=user.id,
        first_name=user.first_name or "",
        username=user.username,
    )

    text = update.message.text.strip()

    MENU_BUTTONS = {
        "🛍 Открыть магазин": cmd_shop,
        "📦 Мои заказы": cmd_orders,
        "❤️ Избранное": cmd_favorites,
        "📞 Поддержка": cmd_support,
        "❓ FAQ": cmd_faq,
        "ℹ️ О магазине": cmd_about,
    }

    if text in MENU_BUTTONS:
        await MENU_BUTTONS[text](update, context)
        return

    support_entered = _support_mode.get(user.id)
    if support_entered and (time.time() - support_entered) < SUPPORT_MODE_TTL:
        display_name = user.first_name
        if user.username:
            display_name += f" (@{user.username})"

        _last_user[ADMIN_ID] = {
            "user_id": user.id,
            "name": display_name,
            "time": time.time(),
        }

        admin_text = (
            "💬 <b>Новое сообщение от пользователя</b>\n\n"
            f"👤 {display_name}\n"
            f"🆔 <code>{user.id}</code>\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"{update.message.text or '(медиа)'}\n\n"
            f"💡 Ответ: <code>/reply {user.id} Текст</code>"
        )

        try:
            await context.bot.send_message(
                chat_id=ADMIN_ID, text=admin_text, parse_mode="HTML"
            )
        except Exception as e:
            logger.error("Failed to notify admin: %s", e)

        await update.message.reply_text(
            "✅ Сообщение отправлено! Ожидайте ответа.",
            reply_markup=support_keyboard(),
        )
        return

    await update.message.reply_text(
        "Используйте кнопки меню ниже 👇\n"
        "Или команду /menu для открытия меню.",
        reply_markup=main_menu_keyboard(),
    )


# ─── Admin commands ─────────────────────────────────────────────────────────


async def cmd_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or user.id != ADMIN_ID:
        await update.message.reply_text("⛔ У вас нет доступа к этой команде.")
        return

    if not context.args:
        await update.message.reply_text(
            "Использование:\n<code>/broadcast Текст сообщения</code>",
            parse_mode="HTML",
        )
        return

    message_text = " ".join(context.args)
    user_count = db.get_user_count()

    status_msg = await update.message.reply_text(
        f"📤 Начинаю рассылку для <b>{user_count}</b> пользователей...",
        parse_mode="HTML",
    )

    result: BroadcastResult = await broadcast(context.bot, message_text, created_by=str(user.id))

    if result.queued:
        report = (
            f"📋 <b>Рассылка в очереди</b>\n\n"
            f"━━━━━━━━━━━━━━━━\n\n"
            f"📊 Получателей: {result.total}\n"
            f"🆔 <code>{result.job_id}</code>\n\n"
            f"Обработка автоматически."
        )
    else:
        report = (
            f"✅ <b>Рассылка завершена</b>\n\n"
            f"━━━━━━━━━━━━━━━━\n\n"
            f"📊 Всего: {result.total}\n"
            f"✓ Доставлено: {result.success}\n"
            f"🚫 Заблокировали: {result.blocked}\n"
            f"⚠️ Ошибки: {result.errors}"
        )
    await status_msg.edit_text(report, parse_mode="HTML")
    logger.info(
        "Broadcast done: total=%d, success=%d, blocked=%d, errors=%d, queued=%s",
        result.total, result.success, result.blocked, result.errors, result.queued,
    )


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or user.id != ADMIN_ID:
        await update.message.reply_text("⛔ У вас нет доступа к этой команде.")
        return

    user_count = db.get_user_count()
    orders_count = db.get_total_orders_count()
    returns_count = db.get_pending_returns_count()
    unread_msgs = db.get_unread_messages_count()

    text = (
        f"📊 <b>Статистика {SHOP_NAME} Bot</b>\n\n"
        "━━━━━━━━━━━━━━━━\n\n"
        f"👥 Подписчиков: <b>{user_count}</b>\n"
        f"📦 Всего заказов: <b>{orders_count}</b>\n"
        f"🔄 Ожидают возврата: <b>{returns_count}</b>\n"
        f"💬 Непрочитанных: <b>{unread_msgs}</b>\n\n"
        f"🕐 {datetime.now().strftime('%d.%m.%Y %H:%M')}"
    )
    await update.message.reply_text(text, parse_mode="HTML")


# ─── Setup ──────────────────────────────────────────────────────────────────


async def post_init(app: Application) -> None:
    commands = [
        BotCommand("start", "Приветствие и главное меню"),
        BotCommand("menu", "Главное меню"),
        BotCommand("orders", "Мои заказы"),
        BotCommand("favorites", "Избранные товары"),
        BotCommand("support", "Связаться с поддержкой"),
        BotCommand("faq", "Часто задаваемые вопросы"),
        BotCommand("about", "О магазине"),
        BotCommand("help", "Справка"),
    ]
    await app.bot.set_my_commands(commands)
    logger.info("Bot commands set.")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.error("Unhandled exception", exc_info=context.error)
    if isinstance(update, Update) and update.effective_chat:
        try:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="⚠️ Произошла ошибка. Попробуйте позже.",
            )
        except Exception:
            pass


def main() -> None:
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()

    app.add_error_handler(error_handler)

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("menu", cmd_menu))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("orders", cmd_orders))
    app.add_handler(CommandHandler("favorites", cmd_favorites))
    app.add_handler(CommandHandler("support", cmd_support))
    app.add_handler(CommandHandler("faq", cmd_faq))
    app.add_handler(CommandHandler("about", cmd_about))
    app.add_handler(CommandHandler("reply", cmd_reply))
    app.add_handler(CommandHandler("broadcast", cmd_broadcast))
    app.add_handler(CommandHandler("stats", cmd_stats))

    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_any_message))

    logger.info("Bot started. ADMIN_ID=%d", ADMIN_ID)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
