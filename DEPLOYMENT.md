# Point Tech - Руководство по развертыванию

## Обзор

Point Tech — современный Telegram Mini App для продаж техники, электроники и аксессуаров на рынке Узбекистана.

## Возможности

- Мультикатегорийный каталог с расширенными фильтрами и сортировкой
- Продвинутая карточка товара с галереей изображений, отзывами и шарингом
- Оплата наличными при получении (онлайн-оплата пока выключена — см.
  «Настройка платежных систем»)
- Реферальная система с бонусами
- Акции и промо-разделы (Новинки, Распродажа, Избранное)
- Система отзывов и рейтингов
- Админ-панель с полным CRUD товаров и управлением заказами
- Двухязычная поддержка (Русский / O'zbekcha)
- Полная интеграция с Telegram WebApp API
- Toast-уведомления и плавные анимации

## Стек технологий

- React 18 + TypeScript + Vite
- Tailwind CSS для стилизации
- Zustand для state management
- TanStack Query для data fetching
- React Router v6 для навигации
- Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions)
- Telegram WebApp SDK

## Развертывание на Vercel

> **Vercel — единственная цель деплоя.** Раньше репозиторий содержал три способа
> отдавать одну и ту же сборку (`vercel.json`, `server.cjs` для Render и
> `nginx.conf` + `Dockerfile.frontend` для Docker), и они расходились: только
> `server.cjs` рендерил Open Graph-превью для краулеров, а бот всё это время
> указывал на Vercel — то есть каждая реальная ссылка на товар приходила в
> Telegram без картинки, названия и цены.
>
> Генерация превью перенесена в `api/product-preview.ts` (Vercel Edge Function).
> Краулеры попадают туда через правило в `vercel.json` с проверкой `User-Agent`;
> обычные посетители, как и прежде, получают SPA.
>
> `server.cjs`, `nginx.conf`, `Dockerfile.frontend` и веб-сервис в `render.yaml`
> удалены. На Render остался только воркер бота. Вернуть любой из файлов:
> `git show HEAD:server.cjs > server.cjs`.
>
> **`WEBAPP_URL` теперь обязателен** и у бота (`bot/config.py`), и в
> `render.yaml`. Раньше он по умолчанию указывал на Render-хост, которого
> больше нет; задайте его равным тому origin, под которым Mini App
> зарегистрирован в @BotFather.

### 0. Про `vercel.json`

В файле **нельзя** держать ключи `comment` — Vercel валидирует конфиг строго и
отклоняет импорт с ошибкой вида
`Invalid request: headers[0] should NOT have additional property comment`.
Пояснения к правилам живут здесь.

**Правило для краулеров.** Первое правило в `rewrites` отправляет запросы
`/product/:slug` в `api/product-preview.ts`, но только если `User-Agent`
совпал со списком ботов. Живые посетители проваливаются в следующее правило
и получают SPA. Порядок важен: catch-all ниже иначе перехватил бы
`/product/:slug` первым.

Проверить после деплоя:

```bash
curl -A "TelegramBot (like TwitterBot)" https://<домен>/product/<slug> | grep og:title
```

Должны прийти og-теги. Если пришёл HTML SPA-оболочки — правило не сработало,
и превью ссылок в Telegram будут пустыми.

**Заголовки безопасности.** `vercel.json` — единственный их источник:
копии в `server.cjs` и `nginx.conf`, которые он раньше дублировал, удалены.
`frame-ancestors` разрешает Telegram, который открывает Mini App в iframe.

### 1. Подготовка Supabase

База данных и Edge Functions уже настроены. Убедитесь, что:

1. Все миграции применены (проверьте в Supabase Dashboard → Database → Migrations)
2. Edge Functions развернуты:
   - `create-payment` - создание платежей
   - `payme-callback` - webhook для Payme

3. Создайте публичный bucket `product-images` в Storage (если еще не создан):
   - Откройте Supabase Dashboard → Storage
   - Создайте новый bucket с именем `product-images`
   - Сделайте его публичным

4. Настройте секреты для Edge Functions в Supabase Dashboard:

   ```bash
   # Обязательные
   TELEGRAM_BOT_TOKEN=...        # принимается и имя BOT_TOKEN
   ADMIN_TELEGRAM_ID=...         # chat id для служебных уведомлений
   ALLOWED_ORIGINS=https://ваш-домен.vercel.app

   # Payme — только если включаете онлайн-оплату (по умолчанию выключена)
   PAYME_MERCHANT_ID=your_merchant_id
   PAYME_BASE_URL=https://checkout.paycom.uz
   PAYME_RETURN_URL=https://ваш-домен.vercel.app
   ```

   `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase подставляет сам.

   **`ALLOWED_ORIGINS` в продакшене обязателен.** Без него
   `supabase/functions/_shared/cors.ts` берёт встроенный список, а в нём —
   `http://localhost:5173`, `http://localhost:4173` и три исторических домена,
   первый из которых (`o1ne.onrender.com`) больше не существует: именно он
   отдаётся браузеру в `Access-Control-Allow-Origin`, когда `Origin` не
   опознан. Список принимает несколько значений через запятую и **заменяет**
   встроенный целиком, поэтому локальные адреса для разработки при
   необходимости надо перечислить явно.

   Переменных `CLICK_*` и `UZUM_*` в коде нет — эти провайдеры не реализованы,
   см. раздел «Настройка платежных систем».

5. Создайте первого администратора.

   **Не через Supabase Auth** — админы этого приложения живут в таблице
   `admin_accounts`, а не в `auth.users`. Пароль хеширует база; в SQL Editor:

   ```sql
   INSERT INTO admin_accounts (email, first_name, role, is_active, password_hash)
   VALUES ('вы@почта', 'Ваше имя', 'super_admin', true,
           hash_admin_password('пароль-не-короче-10-символов'));
   ```

   Прежняя версия этого пункта предлагала завести `admin@shop.uz / Admin123`.
   Такие учётки раньше создавала миграция — она вставляла три пары логин-пароль
   открытым текстом в колонку `password_plain`, которую позже удалили. Заводить
   их не надо: пароль из документации известен всем, у кого есть доступ к
   репозиторию.

### 2. Развертывание на Vercel

1. Подключите репозиторий к Vercel:
   ```bash
   vercel
   ```

2. Настройте переменные окружения в Vercel Dashboard:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_anon_key
   VITE_TELEGRAM_BOT_USERNAME=KuPi_ShoP_Store_Bot
   VITE_SHOP_NAME=Point Tech
   VITE_SENTRY_DSN=https://...ingest.sentry.io/...
   ```
   Полный список с пояснениями — в `.env.example`.

   `VITE_SENTRY_DSN` не обязателен технически, но без него единственный
   канал ошибок — консоль браузера на телефоне внутри Telegram, то есть
   никакой. `initSentry()` вызывается из `src/main.tsx`; без DSN Sentry
   остаётся полностью выключенным, и всё, что раньше уходило в
   `console.error`, там и остаётся.
   Эти переменные читает не только фронтенд, но и `api/product-preview.ts`
   в рантайме — без `VITE_TELEGRAM_BOT_USERNAME` кнопка в превью уведёт
   на бота по умолчанию.

   Контакты (`VITE_CONTACT_PHONE`, `VITE_CONTACT_EMAIL`, `VITE_CONTACT_ADDRESS_RU`
   и остальные из `.env.example`) задайте здесь же: ненастроенные строки просто
   не показываются на `/contact` — фальшивых значений по умолчанию больше нет.

3. Деплой произойдет автоматически при push в main

### 3. Настройка Telegram Mini App

1. Создайте бота через @BotFather
2. Получите токен бота
3. Настройте Web App URL через @BotFather:
   ```
   /newapp
   # Выберите вашего бота
   # Введите название приложения
   # Введите описание
   # Загрузите иконку
   # Введите URL: https://your-vercel-app.vercel.app
   ```

4. Добавьте кнопку Web App в бота:
   ```
   /setmenubutton
   # Выберите вашего бота
   # Введите текст кнопки: "Открыть магазин"
   # Введите URL: https://your-vercel-app.vercel.app
   ```

## Настройка платежных систем

> **Сейчас магазин работает только на оплате при получении.** В чекауте
> (`src/pages/Checkout.tsx`) Payme, Click и Uzum помечены `disabled: true` и
> показываются как «Скоро будет доступно»; выбрать можно только «наличные».
> Раньше здесь были инструкции по подключению всех трёх, хотя реализован из
> них один, — оператор настраивал провайдера, которого в коде нет, и узнавал
> об этом от первого покупателя.

### Payme — реализован, выключен в интерфейсе

Готово в коде: `create-payment` (`case 'payme'`) собирает ссылку на
checkout.paycom.uz, `payme-callback` реализует протокол Payme (CheckPerform /
Create / Perform / Cancel / CheckTransaction) с таблицей `payme_transactions`.

Чтобы включить:

1. Зарегистрируйтесь на https://payme.uz/, получите Merchant ID.
2. Задайте `PAYME_MERCHANT_ID`, `PAYME_BASE_URL`, `PAYME_RETURN_URL`
   в секретах Edge Functions.
3. Укажите в кабинете Payme webhook URL:
   `https://<проект>.supabase.co/functions/v1/payme-callback`
4. Снимите `disabled: true` с пункта `payme` в `src/pages/Checkout.tsx`.
5. Проведите тестовую оплату и убедитесь, что заказ перешёл в `paid`.

### Click и Uzum Bank — не реализованы

Кода нет ни в `create-payment`, ни в отдельной функции обратного вызова:
`create-payment` на любой метод кроме `payme` отвечает `Invalid payment
method`. Снимать `disabled` с этих пунктов нельзя — покупатель дойдёт до
конца оформления и получит ошибку. Подключение каждого — отдельная задача:
функция создания платежа плюс обработчик колбэка с проверкой подписи, по
образцу `payme-callback`.

## Тестирование

### Локальное тестирование

```bash
npm run dev
```

Приложение будет доступно на http://localhost:5173

### Тестирование в Telegram

1. Откройте вашего бота в Telegram
2. Нажмите на кнопку меню или используйте команду /start
3. Mini App откроется внутри Telegram

## Добавление тестовых данных

Используйте админ-панель для добавления товаров:

1. Откройте `/nanyy` в приложении (не `/admin` — путь другой)
2. Войдите под учётной записью, созданной на шаге 1.5
3. Перейдите в "Товары"
4. Добавьте новые товары с изображениями

Или используйте SQL для массового добавления через Supabase SQL Editor.

## Мониторинг и логи

### Supabase

- Database logs: Dashboard → Database → Logs
- Edge Functions logs: Dashboard → Edge Functions → Logs
- Storage usage: Dashboard → Storage → Usage

### Vercel

- Build logs: Vercel Dashboard → Deployments
- Function logs: Vercel Dashboard → Functions

### Sentry (ошибки фронтенда)

Включается заданием `VITE_SENTRY_DSN`. Туда уходят три источника:
падение рендера через `ErrorBoundary`, необработанные промисы и
`window.onerror` из `src/main.tsx`, и исчерпание восьми попыток регистрации
пользователя (`initializeUser`) — последнее раньше проваливалось молча, а
означает оно, что заказы и избранное у этого покупателя работать не будут.

`tracesSampleRate` — 0.1, `environment` берётся из режима сборки.

### Логи бота

`bot/main.py` держит `httpx` и `httpcore` на уровне WARNING намеренно: на INFO
python-telegram-bot пишет URL каждого запроса, а в URL входит токен бота.
Так в репозитории и оказался `bot/bot.log` с 6742 копиями токена открытым
текстом. Логи покрыты `.gitignore`; токен, однажды попавший на диск, нужно
менять через @BotFather.

## Обновления

### Обновление кода

```bash
git add .
git commit -m "Update: описание изменений"
git push origin main
```

Vercel автоматически задеплоит новую версию.

### Обновление базы данных

Создайте новую миграцию в `supabase/migrations/` и примените через Supabase Dashboard.

## Поддержка

Для вопросов и поддержки:
- Telegram: @your_support_username
- Email: support@yourshop.uz

## Безопасность

- Все платежные данные обрабатываются через защищенные Edge Functions
- RLS (Row Level Security) включен для всех таблиц
- API ключи хранятся только в Supabase Secrets
- HTTPS для всех соединений

## Производительность

- Lazy loading изображений
- Code splitting
- Optimistic UI updates
- Realtime subscriptions для заказов
- CDN для статических ресурсов (Vercel)

## Checklist запуска

**Supabase**

- [ ] Проект создан, все миграции применены
- [ ] Storage buckets на месте (создаёт миграция
      `20260814010000_functional_reference_data.sql`)
- [ ] Edge Functions развёрнуты
- [ ] `ALLOWED_ORIGINS` задан рабочим доменом — иначе во встроенном списке
      остаются `localhost` и мёртвый `o1ne.onrender.com`
- [ ] `TELEGRAM_BOT_TOKEN` и `ADMIN_TELEGRAM_ID` заданы
- [ ] Админ-аккаунт заведён через `hash_admin_password` (шаг 1.5), пароль не
      из документации

**Vercel**

- [ ] Проект создан, переменные из `.env.example` заданы
- [ ] `VITE_SENTRY_DSN` задан, тестовая ошибка дошла до Sentry
- [ ] Превью для краулеров отвечает og-тегами
      (`curl -A "TelegramBot" .../product/<slug> | grep og:title`)

**Telegram**

- [ ] Бот создан, Web App URL настроен на тот же origin, что и Vercel
- [ ] `WEBAPP_URL` у воркера на Render равен ему же
- [ ] Токен бота не лежал в логах; если лежал — перевыпущен через @BotFather

**Перед первым покупателем**

- [ ] `npm ci && npm run typecheck && npm run lint && npm test && npm run build`
      проходят на чистой машине
- [ ] Товары добавлены, зоны доставки проверены
- [ ] Оформлен сквозной тестовый заказ с оплатой при получении
- [ ] Мобильный UI проверен внутри Telegram, а не только в браузере

Онлайн-оплата в этот список намеренно не входит: она выключена, см. раздел
«Настройка платежных систем».
