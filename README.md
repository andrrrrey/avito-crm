# Avito CRM

CRM-система для управления чатами Avito с поддержкой AI-ассистента, автоматических дожимов и синхронизации цен в реальном времени.

---

## Содержание

- [Функциональность](#функциональность)
- [Технологии](#технологии)
- [Архитектура](#архитектура)
- [Быстрый старт](#быстрый-старт)
- [Переменные окружения](#переменные-окружения)
- [Запуск в разработке](#запуск-в-разработке)
- [Деплой в продакшн](#деплой-в-продакшн)
- [Настройка интеграции с Avito](#настройка-интеграции-с-avito)
- [AI-ассистент](#ai-ассистент)
- [Cron-задачи](#cron-задачи)
- [API](#api)
- [Управление пользователями](#управление-пользователями)
- [Mock-режим](#mock-режим)

---

## Функциональность

### Управление чатами
- **Единый интерфейс** для всех чатов Avito-аккаунта с отображением имени клиента, товара, цены и последнего сообщения
- **Три статуса чата:**
  - `BOT` — чат обслуживается ботом (AI-ассистентом)
  - `MANAGER` — чат передан живому менеджеру
  - `INACTIVE` — клиент не ответил после дожима
- **Фильтрация по статусу** — отдельные колонки BOT / MANAGER / INACTIVE
- **Сортировка:** по дате последнего сообщения или по цене (по возрастанию/убыванию)
- **Закрепление (pin)** важных чатов вверх списка
- **Счётчик непрочитанных** сообщений на каждом чате
- **Реактивация INACTIVE:** если клиент написал снова, чат автоматически переходит обратно в `BOT`

### Просмотр и отправка сообщений
- Полная история переписки внутри каждого чата
- Отправка сообщений от менеджера через Avito API
- Визуальное разделение входящих/исходящих сообщений и сообщений бота
- Отметка сообщений как прочитанных в Avito и CRM

### AI-ассистент
- Интеграция с **OpenAI** (GPT-4o, GPT-4.1, GPT-5.2 и другие модели через Responses API)
- Интеграция с **DeepSeek** (Chat V3, Reasoner R1 — через OpenAI-совместимый API)
- Автоматические ответы на сообщения в чатах со статусом `BOT`
- **Контекст диалога:** ассистент учитывает историю переписки (до 20 сообщений)
- **Контекст чата:** ассистент знает имя клиента, название товара и цену
- **Эскалация на менеджера:** ИИ добавляет маркер `[ESCALATE]` → чат автоматически переводится в `MANAGER`
- Настраиваемый системный промпт и промпт переключения на менеджера

### База знаний
- **OpenAI:** загрузка файлов в Vector Store (file_search), управление через UI
- **DeepSeek:** локальная база знаний в PostgreSQL, полнотекстовый поиск (RAG)
  - Файлы разбиваются на чанки по 1000 символов с перекрытием 200
  - Поиск через `plainto_tsquery('simple', ...)` с fallback на ILIKE
  - Поддерживаемые форматы: `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.html`

### Синхронизация с Avito
- **Webhook:** мгновенное получение входящих сообщений в реальном времени
- **Ручная синхронизация** всех чатов через POST `/api/avito/sync`
- **Автосинхронизация цен** через cron: актуальные цены объявлений обновляются автоматически
- **Обогащение чатов:** имя клиента, заголовок объявления, URL — подгружаются из Avito API при необходимости

### Автоматические дожимы (Follow-up)
- Если бот ответил клиенту, а клиент не пишет 1 час — автоматически отправляется сообщение «Актуален ли ваш заказ?»
- Дожим отправляется только в чатах с активностью за последние 2 часа
- Если после дожима нет ответа в течение 24 часов — чат переводится в `INACTIVE`
- Запускается через POST `/api/cron/followup` (каждые 5–10 минут)

### Realtime-обновления
- SSE (Server-Sent Events) для мгновенного обновления UI без перезагрузки
- Звуковое уведомление при новом входящем сообщении
- Обновление счётчиков и статусов без polling

### Аутентификация
- Сессионная авторизация (cookie + SHA-256 hash в БД)
- Страница логина `/login`, редирект неавторизованных пользователей
- Настраиваемое время жизни сессии (`SESSION_TTL_DAYS`)

---

## Технологии

| Компонент | Версия |
|---|---|
| Next.js | 16.1.3 |
| React | 19.2.3 |
| TypeScript | 5.9.3 |
| Tailwind CSS | 4.x |
| Prisma ORM | 6.x |
| PostgreSQL | 16 |
| OpenAI SDK | 6.x |
| SWR | 2.x |
| Zod | 4.x |
| bcryptjs | 3.x |

---

## Архитектура

```
avito-crm/
├── prisma/
│   └── schema.prisma          # Схема БД (Chat, Message, User, Session, AiAssistant, KnowledgeBase...)
├── scripts/
│   └── hash-password.ts       # Утилита для хеширования пароля при создании пользователя
├── src/
│   ├── app/
│   │   ├── page.tsx            # Главная страница — список чатов + окно переписки
│   │   ├── login/page.tsx      # Страница логина
│   │   ├── ai-assistant/       # Страница настройки AI-ассистента
│   │   └── api/
│   │       ├── ai-assistant/   # CRUD настроек AI, управление файлами базы знаний
│   │       ├── auth/           # login / logout / me
│   │       ├── avito/
│   │       │   ├── webhook/    # Приём вебхуков от Avito
│   │       │   ├── sync/       # Полная синхронизация чатов
│   │       │   ├── subscribe/  # Управление подпиской на вебхуки
│   │       │   └── fill-prices/# Разовое заполнение цен
│   │       ├── bot/reply/      # Приём команд от внешнего n8n-бота
│   │       ├── chats/
│   │       │   └── [id]/       # Сообщения, отправка, закрепление, завершение, реактивация
│   │       ├── cron/
│   │       │   ├── followup/   # Cron: дожимы и перевод в INACTIVE
│   │       │   └── sync-prices/# Cron: синхронизация цен объявлений
│   │       ├── events/         # SSE endpoint для realtime-обновлений
│   │       └── dev/            # Утилиты для разработки (seed, reset, incoming)
│   ├── lib/
│   │   ├── avito.ts            # Клиент Avito API (OAuth2, чаты, сообщения, объявления, вебхуки)
│   │   ├── auth.ts             # Сессионная аутентификация
│   │   ├── bot.ts              # Интерфейс взаимодействия с внешним ботом (n8n)
│   │   ├── knowledge-base.ts   # Локальная RAG-база знаний для DeepSeek
│   │   ├── openai.ts           # AI-ассистент (OpenAI Responses API + DeepSeek)
│   │   ├── prisma.ts           # Singleton-клиент Prisma
│   │   ├── realtime.ts         # SSE-шина событий (EventEmitter)
│   │   ├── env.ts              # Типизированные переменные окружения
│   │   └── utils.ts            # Вспомогательные функции
│   └── middleware.ts           # Редирект неавторизованных пользователей на /login
├── docker-compose.yml          # PostgreSQL для локальной разработки
└── .env.example                # Пример файла переменных окружения
```

### Модели базы данных

| Модель | Описание |
|---|---|
| `Chat` | Чат Avito: статус, имя клиента, товар, цена, дата последнего сообщения |
| `Message` | Сообщение чата: направление IN/OUT, текст, статус прочтения |
| `IntegrationState` | OAuth2 токены Avito (access + refresh + expiry) |
| `WebhookEvent` | Лог сырых вебхук-событий для дедупликации и диагностики |
| `User` | Пользователь CRM (логин, хеш пароля, роль) |
| `Session` | Активная сессия пользователя (хеш токена, срок жизни) |
| `AiAssistant` | Настройки AI-ассистента (провайдер, ключи, модель, промпты) |
| `KnowledgeBaseFile` | Файл локальной базы знаний (для DeepSeek) |
| `KnowledgeBaseChunk` | Чанк текста из файла базы знаний |

---

## Быстрый старт

### Требования

- Node.js 20+
- npm 10+
- Docker (для PostgreSQL) или внешняя база PostgreSQL

### 1. Клонирование и установка зависимостей

```bash
git clone <repo-url>
cd avito-crm
npm install
```

### 2. Настройка базы данных

Запустите PostgreSQL через Docker:

```bash
docker-compose up -d
```

Или укажите свой `DATABASE_URL` в `.env`.

### 3. Настройка переменных окружения

```bash
cp .env.example .env
```

Заполните `.env` (см. раздел [Переменные окружения](#переменные-окружения)).

### 4. Применение миграций БД

```bash
npx prisma migrate dev
```

### 5. Создание первого пользователя

Захешируйте пароль:

```bash
npx tsx scripts/hash-password.ts ВашПароль
```

Скопируйте вывод и запишите пользователя в БД через Prisma Studio:

```bash
npx prisma studio
```

Или через SQL:

```sql
INSERT INTO "User" (id, username, "passwordHash", "isActive", role, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'admin', '<хеш_из_шага_выше>', true, 'MANAGER', NOW(), NOW());
```

### 6. Запуск

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) и войдите с созданным логином/паролем.

---

## Переменные окружения

Создайте файл `.env` на основе `.env.example`:

```env
# База данных (PostgreSQL)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/avito_crm

# Avito API
AVITO_CLIENT_ID=        # Client ID из кабинета разработчика Avito
AVITO_CLIENT_SECRET=    # Client Secret из кабинета разработчика Avito
AVITO_ACCOUNT_ID=       # Числовой ID вашего Avito-аккаунта
AVITO_REDIRECT_URI=     # URI редиректа OAuth (если используется)
AVITO_DEFAULT_STATUS=BOT  # Статус новых чатов по умолчанию (BOT или MANAGER)

# Публичный URL приложения (для регистрации вебхука)
PUBLIC_BASE_URL=https://your-domain.com

# Аутентификация сессий
SESSION_COOKIE_NAME=crm_session  # Имя cookie
SESSION_TTL_DAYS=30              # Время жизни сессии в днях

# Токен для cron-задач
CRM_CRON_TOKEN=your-secret-cron-token

# Внешний бот через n8n (опционально)
N8N_BOT_WEBHOOK_URL=https://your-n8n.com/webhook/...

# Mock-режим для разработки без Avito API (true / false)
MOCK_MODE=false
NEXT_PUBLIC_MOCK_MODE=false
```

### Описание переменных

| Переменная | Обязательная | Описание |
|---|---|---|
| `DATABASE_URL` | Да | Connection string PostgreSQL |
| `AVITO_CLIENT_ID` | Да | Client ID приложения Avito |
| `AVITO_CLIENT_SECRET` | Да | Client Secret приложения Avito |
| `AVITO_ACCOUNT_ID` | Да | Числовой ID аккаунта Avito |
| `PUBLIC_BASE_URL` | Да | Публичный URL для вебхука Avito |
| `SESSION_COOKIE_NAME` | Да | Имя cookie сессии |
| `SESSION_TTL_DAYS` | Да | Время жизни сессии (дни) |
| `CRM_CRON_TOKEN` | Да | Секретный токен для cron-эндпоинтов |
| `AVITO_DEFAULT_STATUS` | Нет | Статус новых чатов: `BOT` (по умолчанию) или `MANAGER` |
| `N8N_BOT_WEBHOOK_URL` | Нет | URL вебхука внешнего n8n-бота |
| `MOCK_MODE` | Нет | Режим без реальных Avito API вызовов |
| `NEXT_PUBLIC_MOCK_MODE` | Нет | То же, видимо клиентской части |

---

## Запуск в разработке

```bash
# Запуск с hot-reload
npm run dev

# Линтинг
npm run lint

# Генерация Prisma Client (после изменения схемы)
npx prisma generate

# Применение миграций
npx prisma migrate dev --name <название_миграции>

# Просмотр данных в браузере
npx prisma studio
```

### Mock-режим

В разработке можно включить mock-режим — тогда Avito API не вызывается, а все операции с чатами и сообщениями работают только в БД:

```env
MOCK_MODE=true
NEXT_PUBLIC_MOCK_MODE=true
```

В mock-режиме доступны dev-утилиты:

- `POST /api/dev/seed` — заполнить БД тестовыми данными
- `POST /api/dev/reset` — очистить все чаты и сообщения
- `POST /api/dev/incoming` — симулировать входящее сообщение
- `GET /api/dev/whoami` — проверить текущую сессию

---

## Деплой в продакшн

### Сборка

```bash
npm run build
npm run start
```

`npm run build` автоматически запускает `prisma generate` перед сборкой Next.js.

### Рекомендуемая схема деплоя

1. **PostgreSQL** — отдельный managed-сервис или Docker-контейнер
2. **Node.js-процесс** — PM2, systemd или Docker-контейнер
3. **Reverse proxy** — Nginx или Caddy с SSL (обязателен для HTTPS, который требует Avito webhook)

### Пример с PM2

```bash
npm install -g pm2
npm run build
pm2 start npm --name "avito-crm" -- start
pm2 save
pm2 startup
```

### Важно для продакшна

- Приложение должно быть доступно по HTTPS — Avito отправляет вебхуки только на HTTPS-адреса
- Убедитесь, что `PUBLIC_BASE_URL` указывает на ваш публичный домен
- После запуска зарегистрируйте вебхук через Avito API (см. ниже)

---

## Настройка интеграции с Avito

### 1. Регистрация приложения Avito

1. Зайдите на [developers.avito.ru](https://developers.avito.ru)
2. Создайте приложение, получите `client_id` и `client_secret`
3. Убедитесь, что приложению разрешены scope: `messenger:read messenger:write items:info`
4. Узнайте числовой `account_id` вашего аккаунта

### 2. Получение токенов

Приложение использует `grant_type=client_credentials` — токены получаются автоматически при первом запросе и обновляются по истечении срока действия. Ничего настраивать вручную не нужно.

### 3. Регистрация вебхука

После запуска приложения зарегистрируйте вебхук на Avito:

```bash
curl -X POST https://your-domain.com/api/avito/subscribe \
  -H "Cookie: crm_session=<your-session-token>"
```

Avito будет отправлять события по адресу: `https://your-domain.com/api/avito/webhook`

### 4. Первоначальная синхронизация чатов

После регистрации вебхука выполните ручную синхронизацию, чтобы загрузить все существующие чаты:

```bash
curl -X POST https://your-domain.com/api/avito/sync \
  -H "Cookie: crm_session=<your-session-token>"
```

---

## AI-ассистент

Настройка доступна по пути `/ai-assistant` в интерфейсе CRM.

### Поддерживаемые провайдеры

**OpenAI (Responses API)**

Поддерживаемые модели:
- `gpt-5.2` — GPT-5.2 Thinking
- `gpt-5.2-chat-latest` — GPT-5.2 Instant
- `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- `gpt-4o`, `gpt-4o-mini`
- `o3-mini`

Дополнительно: Vector Store (file_search) для поиска по базе знаний.

**DeepSeek (Chat Completions API)**

Поддерживаемые модели:
- `deepseek-chat` — DeepSeek Chat (V3)
- `deepseek-reasoner` — DeepSeek Reasoner (R1)

База знаний хранится локально в PostgreSQL (RAG через full-text search).

### Как работает AI-ассистент

1. Входящее сообщение от клиента попадает через вебхук
2. Если чат в статусе `BOT` и ассистент включён — запускается `getAssistantReply()`
3. Ассистент получает историю чата (последние 20 сообщений) и контекст (имя клиента, товар, цена)
4. Для OpenAI: используется Responses API с `previous_response_id` для продолжения диалога
5. Для DeepSeek: строится полный массив messages с системным промптом и историей
6. Если в ответе есть маркер `[ESCALATE]` — чат переводится в `MANAGER`, клиенту отправляется прощальное сообщение
7. Ответ отправляется в Avito API и сохраняется в БД

### Настройка эскалации

В разделе «Промпт переключения на менеджера» можно задать собственные условия передачи диалога живому менеджеру. По умолчанию используется встроенный промпт:

- Клиент просит позвать оператора/менеджера
- Ответ не найден в базе знаний
- Клиент конфликтует или жалуется
- Нужно действие менеджера: возврат, компенсация, изменение заказа

### База знаний

**Для OpenAI:**
1. Создайте Vector Store в OpenAI Platform
2. Укажите его ID в поле «Vector Store ID»
3. Загрузите файлы через раздел «Файлы Vector Store» в UI

**Для DeepSeek:**
1. Загрузите файлы через раздел «База знаний» в UI
2. Поддерживаемые форматы: `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.html`
3. Файлы автоматически разбиваются на чанки и индексируются в PostgreSQL

---

## Cron-задачи

Обе cron-задачи защищены токеном `CRM_CRON_TOKEN`. Токен передаётся через query-параметр `?token=<CRM_CRON_TOKEN>`.

### Дожимы (`/api/cron/followup`)

Запускать каждые **5–10 минут**.

```bash
# Пример с curl
curl -X POST "https://your-domain.com/api/cron/followup?token=YOUR_CRON_TOKEN"

# Пример записи в crontab
*/5 * * * * curl -s -X POST "https://your-domain.com/api/cron/followup?token=YOUR_CRON_TOKEN"
```

**Логика:**
1. Находит BOT-чаты, где последнее сообщение от бота было 1–2 часа назад и клиент не ответил
2. Отправляет сообщение «Актуален ли ваш заказ?»
3. Находит BOT-чаты, где дожим был отправлен более 24 часов назад и клиент так и не ответил
4. Переводит такие чаты в статус `INACTIVE`

Пример ответа:
```json
{
  "ok": true,
  "stats": {
    "followupsSent": 3,
    "markedInactive": 1,
    "errors": 0
  }
}
```

### Синхронизация цен (`/api/cron/sync-prices`)

Запускать каждые **30 минут – 2 часа**.

```bash
curl -X POST "https://your-domain.com/api/cron/sync-prices?token=YOUR_CRON_TOKEN"

# Пример записи в crontab
0 */1 * * * curl -s -X POST "https://your-domain.com/api/cron/sync-prices?token=YOUR_CRON_TOKEN"
```

**Логика:**
1. Загружает все объявления аккаунта через Avito Items API (`/core/v1/items`)
2. Обходит все чаты в БД
3. Для каждого чата извлекает `item_id` из URL объявления или raw-данных
4. Если цена/заголовок изменились — обновляет в БД и публикует SSE-событие

Пример ответа:
```json
{
  "ok": true,
  "stats": {
    "itemsInAccount": 45,
    "chatsChecked": 120,
    "priceUpdated": 5,
    "titleUpdated": 2,
    "noItemId": 10,
    "notFound": 3,
    "errors": 0
  }
}
```

---

## API

Все API-эндпоинты (кроме `/api/auth/login` и `/api/avito/webhook`) требуют авторизацию через cookie-сессию.

### Аутентификация

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/auth/login` | Вход: `{ username, password }` → устанавливает cookie |
| `POST` | `/api/auth/logout` | Выход: удаляет сессию |
| `GET` | `/api/auth/me` | Данные текущего пользователя |

### Чаты

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/chats` | Список чатов (фильтрация, сортировка, пагинация) |
| `GET` | `/api/chats/[id]/messages` | Сообщения конкретного чата |
| `POST` | `/api/chats/[id]/send` | Отправить сообщение в чат |
| `POST` | `/api/chats/[id]/read` | Отметить сообщения прочитанными |
| `POST` | `/api/chats/[id]/pin` | Закрепить/открепить чат |
| `POST` | `/api/chats/[id]/finish` | Завершить чат (перевести в MANAGER) |
| `POST` | `/api/chats/[id]/reactivate` | Реактивировать чат (BOT ← INACTIVE) |

### Avito

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/avito/webhook` | Приём вебхуков от Avito |
| `POST` | `/api/avito/sync` | Полная синхронизация чатов из Avito |
| `POST` | `/api/avito/subscribe` | Подписка на вебхуки Avito |
| `POST` | `/api/avito/fill-prices` | Разовое заполнение цен в чатах |

### AI-ассистент

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/ai-assistant` | Получить текущие настройки |
| `PUT` | `/api/ai-assistant` | Сохранить настройки |
| `GET` | `/api/ai-assistant/files` | Список файлов OpenAI Vector Store |
| `POST` | `/api/ai-assistant/files` | Загрузить файл в Vector Store |
| `DELETE` | `/api/ai-assistant/files` | Удалить файл из Vector Store |
| `GET` | `/api/ai-assistant/deepseek-files` | Список файлов локальной базы знаний |
| `POST` | `/api/ai-assistant/deepseek-files` | Загрузить файл в локальную базу знаний |
| `DELETE` | `/api/ai-assistant/deepseek-files` | Удалить файл из локальной базы знаний |

### Cron

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/cron/followup` | Отправить дожимы и перевести в INACTIVE |
| `POST` | `/api/cron/sync-prices` | Синхронизировать цены объявлений |

### Realtime

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/events` | SSE-поток событий для realtime-обновлений UI |

### n8n-бот (опционально)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/bot/reply` | Принять ответ от внешнего n8n-бота |

---

## Управление пользователями

В текущей версии пользователи создаются вручную через Prisma Studio или SQL. Управление из UI не реализовано.

### Создание пользователя

```bash
# 1. Сгенерировать хеш пароля
npx tsx scripts/hash-password.ts MySecurePassword123

# 2. Записать в БД через Prisma Studio
npx prisma studio
# Открыть таблицу User → Add record

# Или через SQL
psql $DATABASE_URL -c "
INSERT INTO \"User\" (id, username, \"passwordHash\", \"isActive\", role, \"createdAt\", \"updatedAt\")
VALUES (gen_random_uuid(), 'manager1', '<хеш_из_шага_1>', true, 'MANAGER', NOW(), NOW());
"
```

### Деактивация пользователя

```sql
UPDATE "User" SET "isActive" = false WHERE username = 'manager1';
```

При деактивации все активные сессии пользователя автоматически отклоняются при следующем запросе.

---

## Mock-режим

Mock-режим позволяет разрабатывать и тестировать CRM без подключения к Avito API.

```env
MOCK_MODE=true
NEXT_PUBLIC_MOCK_MODE=true
```

В mock-режиме:
- Все исходящие сообщения сохраняются только в БД (не отправляются в Avito)
- Вебхуки принимаются без проверки подписи
- Синхронизация цен пропускается
- Дожимы работают, но сообщения не отправляются в Avito

### Dev-утилиты в mock-режиме

```bash
# Заполнить БД тестовыми данными
curl -X POST http://localhost:3000/api/dev/seed

# Очистить все данные
curl -X POST http://localhost:3000/api/dev/reset

# Симулировать входящее сообщение
curl -X POST http://localhost:3000/api/dev/incoming \
  -H "Content-Type: application/json" \
  -d '{"avitoChatId": "test_chat_123", "text": "Привет, есть в наличии?"}'

# Проверить текущую сессию
curl http://localhost:3000/api/dev/whoami
```
