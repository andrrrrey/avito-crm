# Avito CRM

CRM-система для управления чатами Avito с поддержкой AI-ассистента, автоматических дожимов, синхронизации цен и многопользовательского доступа в реальном времени.

---

## Содержание

- [Обзор проекта](#обзор-проекта)
- [Функциональность](#функциональность)
- [Технологии](#технологии)
- [Архитектура](#архитектура)
- [Переменные окружения](#переменные-окружения)
- [Быстрый старт (локально)](#быстрый-старт-локально)
- [Деплой на VPS Ubuntu](#деплой-на-vps-ubuntu)
- [Настройка Nginx + SSL](#настройка-nginx--ssl)
- [Настройка интеграции с Avito](#настройка-интеграции-с-avito)
- [AI-ассистент](#ai-ассистент)
- [Управление пользователями](#управление-пользователями)
- [Cron-задачи](#cron-задачи)
- [API Reference](#api-reference)
- [Mock-режим для разработки](#mock-режим-для-разработки)
- [Обслуживание и мониторинг](#обслуживание-и-мониторинг)

---

## Обзор проекта

**Avito CRM** — полнофункциональная система управления диалогами Avito. Приложение принимает входящие сообщения через webhook Avito, автоматически отвечает с помощью AI-ассистента (OpenAI или DeepSeek), позволяет менеджерам подхватывать диалоги в реальном времени, отправляет автоматические дожимы и ведёт историю переписки.

**Ключевые возможности:**
- Мгновенный приём входящих сообщений через Avito Webhook
- AI-автоответчик на базе OpenAI (GPT-4o/GPT-4.1/GPT-5.2) или DeepSeek (V3/R1)
- База знаний: Vector Store (OpenAI) или локальный RAG на PostgreSQL (DeepSeek)
- Три статуса чата: BOT → MANAGER → INACTIVE с автоматическими переходами
- Автоматические дожимы + перевод в INACTIVE при отсутствии ответа
- Realtime-обновления UI через SSE (Server-Sent Events)
- Синхронизация цен объявлений по расписанию
- Многопользовательский доступ с регистрацией, ролями и индивидуальными настройками

---

## Функциональность

### Управление чатами

- **Единый интерфейс** для всех чатов Avito-аккаунта: имя клиента, название товара, цена, дата последнего сообщения
- **Три статуса чата:**
  - `BOT` — чат обслуживается AI-ассистентом автоматически
  - `MANAGER` — чат передан живому менеджеру для ручного ответа
  - `INACTIVE` — клиент не ответил после дожима, чат архивирован
- **Колонки по статусам** — фильтрация одним кликом
- **Сортировка:**
  - По дате последнего сообщения (новые/старые)
  - По цене объявления (дороже/дешевле)
- **Закрепление (pin)** важных чатов в начало списка
- **Счётчик непрочитанных** сообщений на каждом чате
- **Автореактивация:** если клиент пишет в INACTIVE-чат — статус автоматически возвращается в `BOT`
- **Ручная реактивация** чата из INACTIVE обратно в BOT

### Просмотр и отправка сообщений

- Полная история переписки внутри каждого чата
- Отправка сообщений от менеджера напрямую через Avito API
- Визуальное разделение входящих / исходящих / бот-сообщений
- Отметка сообщений как прочитанных в Avito и в CRM одновременно
- Отображение времени каждого сообщения

### AI-ассистент

- Интеграция с **OpenAI** (Responses API) — GPT-4o, GPT-4.1, GPT-5.2 и другие
- Интеграция с **DeepSeek** (Chat Completions API) — Chat V3, Reasoner R1
- Автоматические ответы на входящие сообщения в чатах со статусом `BOT`
- **Контекст диалога:** ассистент учитывает историю переписки (до 20 сообщений)
- **Контекст чата:** ассистент знает имя клиента, название товара и цену объявления
- **Непрерывность диалога:**
  - OpenAI: `previous_response_id` для продолжения сессии без пересылки всей истории
  - DeepSeek: полный массив `messages` с системным промптом
- **Эскалация:** ИИ добавляет маркер `[ESCALATE]` → чат переводится в `MANAGER`, клиенту отправляется прощальное сообщение
- Настраиваемые системный промпт и промпт условий эскалации (глобально и per-user)

### База знаний

- **OpenAI Vector Store:**
  - Загрузка файлов через интерфейс CRM
  - Поиск по базе через инструмент `file_search`
  - Любые текстовые форматы
- **DeepSeek — локальный RAG (PostgreSQL):**
  - Файлы разбиваются на чанки (1000 символов, перекрытие 200)
  - Поиск через `plainto_tsquery('simple', ...)` с fallback на ILIKE
  - Поддерживаемые форматы: `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.html`

### Синхронизация с Avito

- **Webhook:** мгновенное получение входящих сообщений в реальном времени
- **Ручная синхронизация** всех чатов через UI или API
- **Автосинхронизация цен** по cron: актуальные цены объявлений обновляются автоматически
- **Обогащение чатов:** имя клиента, заголовок объявления, URL — подгружаются из Avito API при необходимости
- **Fallback-цепочка:** API v3 → v2 → v1 при недоступности версий

### Автоматические дожимы (Follow-up)

- Если бот ответил, а клиент молчит **1 час** → автоматически отправляется сообщение «Актуален ли ваш заказ?»
- Дожимы применяются только к чатам с активностью за **последние 2 часа**
- Если после дожима нет ответа в течение **24 часов** → чат переводится в `INACTIVE`
- Cron запускается каждые **5–10 минут**

### Realtime-обновления

- SSE (Server-Sent Events) для мгновенного обновления UI без перезагрузки страницы
- Звуковое уведомление при новом входящем сообщении
- Обновление счётчиков непрочитанных сообщений в реальном времени
- Keep-alive пинги каждые 25 секунд для поддержки соединения

### Аутентификация и пользователи

- Регистрация новых пользователей через `/register`
- Вход по email + пароль через `/login`
- Cookie-сессия с SHA-256 хешированием токена в БД
- Настраиваемое время жизни сессии (`SESSION_TTL_DAYS`, по умолчанию 30 дней)
- Автоматический редирект неавторизованных пользователей на `/login`
- Роли: `ADMIN` (полный доступ) и `USER` (ограниченный доступ)
- **Per-user настройки:**
  - Индивидуальные учётные данные Avito
  - Индивидуальные инструкции для AI-ассистента
  - Индивидуальный промпт эскалации

---

## Технологии

| Компонент | Версия | Назначение |
|---|---|---|
| Next.js | 16.1.3 | Фреймворк (SSR + API Routes) |
| React | 19.2.3 | UI-библиотека |
| TypeScript | 5.9.3 | Типизация |
| Tailwind CSS | 4.x | Стили |
| Prisma ORM | 6.19.2 | Работа с БД |
| PostgreSQL | 16 | База данных |
| OpenAI SDK | 6.x | AI-интеграция (OpenAI + DeepSeek) |
| SWR | 2.3.8 | Клиентский data-fetching |
| Zod | 4.3.5 | Валидация переменных окружения |
| bcryptjs | 3.0.3 | Хеширование паролей |

---

## Архитектура

```
avito-crm/
├── prisma/
│   ├── schema.prisma              # Схема БД
│   └── migrations/                # 13 миграций
├── scripts/
│   └── hash-password.ts           # Утилита хеширования пароля
├── src/
│   ├── app/
│   │   ├── page.tsx               # Главная — список чатов + окно переписки
│   │   ├── login/page.tsx         # Страница логина
│   │   ├── register/page.tsx      # Страница регистрации
│   │   ├── dashboard/page.tsx     # Личный кабинет (per-user настройки)
│   │   ├── ai-assistant/          # Настройки AI-ассистента (admin)
│   │   ├── layout.tsx             # Корневой Layout
│   │   └── api/
│   │       ├── auth/              # login / logout / register / me
│   │       ├── chats/[id]/        # messages / send / read / pin / finish / reactivate
│   │       ├── avito/             # webhook / sync / subscribe / fill-prices
│   │       ├── ai-assistant/      # settings / files (OpenAI) / deepseek-files
│   │       ├── cron/              # followup / sync-prices
│   │       ├── events/            # SSE endpoint
│   │       ├── bot/reply/         # Внешний n8n-бот
│   │       ├── user/settings/     # Per-user настройки
│   │       └── dev/               # seed / reset / incoming / whoami (mock only)
│   ├── lib/
│   │   ├── avito.ts               # Avito API клиент (OAuth2, чаты, сообщения, товары, webhooks)
│   │   ├── auth.ts                # Сессионная аутентификация
│   │   ├── bot.ts                 # Интеграция с внешним n8n-ботом
│   │   ├── knowledge-base.ts      # Локальная RAG-база для DeepSeek
│   │   ├── openai.ts              # AI-ассистент (OpenAI Responses API + DeepSeek)
│   │   ├── prisma.ts              # Singleton-клиент Prisma
│   │   ├── realtime.ts            # SSE-шина событий (EventEmitter)
│   │   ├── env.ts                 # Типизированные переменные окружения (Zod)
│   │   └── utils.ts               # Вспомогательные функции
│   └── middleware.ts              # Редирект неавторизованных на /login
├── docker-compose.yml             # PostgreSQL для разработки
├── .env.example                   # Шаблон переменных окружения
└── package.json
```

### Модели базы данных

| Модель | Описание |
|---|---|
| `Chat` | Чат Avito: статус (BOT/MANAGER/INACTIVE), имя клиента, товар, цена, pin, lastMessageAt |
| `Message` | Сообщение: направление IN/OUT, текст, статус прочтения, sentAt |
| `User` | Пользователь CRM: email, хеш пароля, роль (ADMIN/USER) |
| `Session` | Сессия: SHA-256 хеш токена, срок жизни |
| `IntegrationState` | OAuth2-токены Avito (access + refresh + expiry) |
| `WebhookEvent` | Лог входящих вебхук-событий для дедупликации |
| `AiAssistant` | Настройки AI: провайдер, ключи, модель, промпты |
| `KnowledgeBaseFile` | Файл локальной базы знаний (для DeepSeek) |
| `KnowledgeBaseChunk` | Текстовый чанк из файла базы знаний |

---

## Переменные окружения

Создайте `.env` на основе `.env.example`:

```env
# ──────────────────────────────────────────────────────────
# База данных
# ──────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:strongpassword@localhost:5432/avito_crm

# ──────────────────────────────────────────────────────────
# Avito API (получить на developers.avito.ru)
# ──────────────────────────────────────────────────────────
AVITO_CLIENT_ID=ваш_client_id
AVITO_CLIENT_SECRET=ваш_client_secret
AVITO_ACCOUNT_ID=123456789          # Числовой ID аккаунта Avito
AVITO_REDIRECT_URI=                 # URI редиректа OAuth (если используется)
AVITO_DEFAULT_STATUS=BOT            # Статус новых чатов: BOT или MANAGER

# ──────────────────────────────────────────────────────────
# Публичный URL приложения (для регистрации вебхука Avito)
# Обязательно HTTPS в продакшне
# ──────────────────────────────────────────────────────────
PUBLIC_BASE_URL=https://your-domain.com

# ──────────────────────────────────────────────────────────
# Сессии
# ──────────────────────────────────────────────────────────
SESSION_COOKIE_NAME=crm_session
SESSION_TTL_DAYS=30

# ──────────────────────────────────────────────────────────
# Токен для защиты cron-эндпоинтов
# ──────────────────────────────────────────────────────────
CRM_CRON_TOKEN=придумайте-длинный-случайный-токен

# ──────────────────────────────────────────────────────────
# Внешний n8n-бот (опционально)
# ──────────────────────────────────────────────────────────
N8N_BOT_WEBHOOK_URL=
CRM_BOT_TOKEN=

# ──────────────────────────────────────────────────────────
# Mock-режим (только для разработки, без реальных Avito API)
# ──────────────────────────────────────────────────────────
MOCK_MODE=false
NEXT_PUBLIC_MOCK_MODE=false
```

### Описание всех переменных

| Переменная | Обязательная | Описание |
|---|---|---|
| `DATABASE_URL` | Да | PostgreSQL connection string |
| `AVITO_CLIENT_ID` | Да | Client ID из кабинета разработчика Avito |
| `AVITO_CLIENT_SECRET` | Да | Client Secret из кабинета разработчика Avito |
| `AVITO_ACCOUNT_ID` | Да | Числовой ID аккаунта Avito |
| `PUBLIC_BASE_URL` | Да | Публичный HTTPS URL (для вебхука Avito) |
| `SESSION_COOKIE_NAME` | Да | Имя cookie сессии |
| `SESSION_TTL_DAYS` | Да | Время жизни сессии в днях |
| `CRM_CRON_TOKEN` | Да | Секрет для cron-эндпоинтов |
| `AVITO_REDIRECT_URI` | Нет | URI редиректа OAuth2 |
| `AVITO_DEFAULT_STATUS` | Нет | Статус новых чатов: `BOT` (по умолчанию) или `MANAGER` |
| `N8N_BOT_WEBHOOK_URL` | Нет | URL вебхука внешнего n8n-бота |
| `CRM_BOT_TOKEN` | Нет | Токен аутентификации для n8n-бота |
| `MOCK_MODE` | Нет | `true` — отключить Avito API вызовы (dev-режим) |
| `NEXT_PUBLIC_MOCK_MODE` | Нет | `true` — то же для клиентской части |

---

## Быстрый старт (локально)

### Требования

- Node.js 20+
- npm 10+
- Docker (для PostgreSQL) или внешняя БД PostgreSQL 16

### Шаги

```bash
# 1. Клонировать репозиторий
git clone <repo-url>
cd avito-crm

# 2. Установить зависимости
npm install

# 3. Запустить PostgreSQL через Docker
docker-compose up -d

# 4. Настроить переменные окружения
cp .env.example .env
# Отредактируйте .env (заполните Avito credentials)

# 5. Применить миграции БД
npx prisma migrate dev

# 6. Запустить приложение в режиме разработки
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) — будет предложена регистрация первого пользователя.

---

## Деплой на VPS Ubuntu

Полная инструкция по развёртыванию на сервере Ubuntu 22.04 / 24.04 с PostgreSQL, Nginx, SSL и PM2.

### 1. Подготовка сервера

```bash
# Подключитесь к серверу по SSH
ssh user@your-server-ip

# Обновите систему
sudo apt update && sudo apt upgrade -y

# Установите необходимые пакеты
sudo apt install -y git curl wget build-essential
```

### 2. Установка Node.js 20

```bash
# Добавьте официальный репозиторий NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Установите Node.js
sudo apt install -y nodejs

# Проверьте версии
node --version   # должно быть v20.x.x
npm --version    # должно быть 10.x.x
```

### 3. Установка PostgreSQL 16

```bash
# Добавьте репозиторий PostgreSQL
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh

# Установите PostgreSQL 16
sudo apt install -y postgresql-16

# Запустите и включите автозапуск
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Создайте пользователя и базу данных
sudo -u postgres psql << 'EOF'
CREATE USER avito_crm_user WITH PASSWORD 'StrongPassword123!';
CREATE DATABASE avito_crm OWNER avito_crm_user;
GRANT ALL PRIVILEGES ON DATABASE avito_crm TO avito_crm_user;
\q
EOF
```

### 4. Клонирование проекта

```bash
# Создайте директорию для приложения
sudo mkdir -p /var/www/avito-crm
sudo chown $USER:$USER /var/www/avito-crm

# Клонируйте репозиторий
git clone <repo-url> /var/www/avito-crm
cd /var/www/avito-crm

# Установите зависимости
npm install --production=false
```

### 5. Настройка переменных окружения

```bash
cd /var/www/avito-crm

# Создайте файл .env
cp .env.example .env

# Отредактируйте .env
nano .env
```

Заполните `.env` (пример для продакшна):

```env
DATABASE_URL=postgresql://avito_crm_user:StrongPassword123!@localhost:5432/avito_crm
AVITO_CLIENT_ID=ваш_client_id
AVITO_CLIENT_SECRET=ваш_client_secret
AVITO_ACCOUNT_ID=123456789
AVITO_DEFAULT_STATUS=BOT
PUBLIC_BASE_URL=https://your-domain.com
SESSION_COOKIE_NAME=crm_session
SESSION_TTL_DAYS=30
CRM_CRON_TOKEN=$(openssl rand -hex 32)
MOCK_MODE=false
NEXT_PUBLIC_MOCK_MODE=false
```

> **Совет:** Сгенерируйте безопасный `CRM_CRON_TOKEN` командой `openssl rand -hex 32`

### 6. Применение миграций и сборка

```bash
cd /var/www/avito-crm

# Применить миграции базы данных
npx prisma migrate deploy

# Собрать Next.js приложение (автоматически запускает prisma generate)
npm run build
```

### 7. Установка и настройка PM2

```bash
# Установите PM2 глобально
sudo npm install -g pm2

# Запустите приложение
cd /var/www/avito-crm
pm2 start npm --name "avito-crm" -- start

# Настройте автозапуск при перезагрузке сервера
pm2 save
pm2 startup

# Следуйте выводу команды pm2 startup (выполните предложенную sudo команду)
# Пример: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Полезные команды PM2:

```bash
pm2 status              # статус процессов
pm2 logs avito-crm      # логи приложения
pm2 logs avito-crm --lines 100  # последние 100 строк логов
pm2 restart avito-crm   # перезапустить
pm2 stop avito-crm      # остановить
pm2 delete avito-crm    # удалить из PM2
```

### 8. Обновление приложения

```bash
cd /var/www/avito-crm

# Получить обновления
git pull origin main

# Установить новые зависимости (если появились)
npm install --production=false

# Применить новые миграции
npx prisma migrate deploy

# Пересобрать и перезапустить
npm run build
pm2 restart avito-crm
```

---

## Настройка Nginx + SSL

### 1. Установка Nginx и Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Настройка Nginx (без SSL, для получения сертификата)

```bash
sudo nano /etc/nginx/sites-available/avito-crm
```

Вставьте конфигурацию:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Таймаут для SSE (Server-Sent Events)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
# Активируйте конфигурацию
sudo ln -s /etc/nginx/sites-available/avito-crm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Получение SSL-сертификата

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Certbot автоматически добавит SSL-конфигурацию в Nginx. После получения сертификата финальная конфигурация будет выглядеть примерно так:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com www.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Заголовки безопасности
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Максимальный размер тела запроса (для загрузки файлов в базу знаний)
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Большой таймаут для SSE-соединений
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

```bash
# Проверьте и перезагрузите Nginx
sudo nginx -t
sudo systemctl reload nginx

# Настройте автообновление сертификата
sudo systemctl enable certbot.timer
sudo certbot renew --dry-run   # тестовый прогон
```

### 4. Настройка файрвола

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## Настройка интеграции с Avito

### 1. Создание приложения в кабинете разработчика

1. Перейдите на [developers.avito.ru](https://developers.avito.ru)
2. Создайте новое приложение
3. Скопируйте `Client ID` и `Client Secret`
4. В настройках приложения укажите необходимые **scope**:
   - `messenger:read` — чтение сообщений
   - `messenger:write` — отправка сообщений
   - `items:info` — информация об объявлениях

### 2. Получение Account ID

Account ID — числовой идентификатор вашего профиля на Avito. Его можно найти:
- В URL вашего профиля на Avito
- Через [API Avito](https://api.avito.ru/core/v1/accounts/self) после получения токена

### 3. OAuth2 токены

Приложение использует `grant_type=client_credentials` — токены получаются **автоматически** при первом запросе к Avito API и обновляются по истечении срока действия. Ничего настраивать вручную не нужно.

### 4. Регистрация вебхука

После запуска приложения и настройки домена зарегистрируйте вебхук:

```bash
# Через браузер — войдите в CRM и выполните запрос через DevTools, или:
curl -X POST https://your-domain.com/api/avito/subscribe \
  -H "Cookie: crm_session=<токен-из-cookie>"
```

Avito будет отправлять события на адрес: `https://your-domain.com/api/avito/webhook`

> **Важно:** Avito требует HTTPS для вебхуков. HTTP-адреса не принимаются.

### 5. Первоначальная синхронизация чатов

После регистрации вебхука загрузите все существующие чаты:

```bash
curl -X POST https://your-domain.com/api/avito/sync \
  -H "Cookie: crm_session=<токен-из-cookie>"
```

Или нажмите кнопку «Синхронизировать» в интерфейсе CRM.

---

## AI-ассистент

Настройка доступна по пути `/ai-assistant` в интерфейсе CRM (только для ADMIN).

### Поддерживаемые провайдеры

**OpenAI (Responses API)**

| Модель | Описание |
|---|---|
| `gpt-5.2` | GPT-5.2 Thinking — самый мощный |
| `gpt-5.2-chat-latest` | GPT-5.2 Instant — быстрый |
| `gpt-4.1` | GPT-4.1 — оптимальный |
| `gpt-4.1-mini` | GPT-4.1 Mini — экономичный |
| `gpt-4.1-nano` | GPT-4.1 Nano — минимальный |
| `gpt-4o` | GPT-4o |
| `gpt-4o-mini` | GPT-4o Mini |
| `o3-mini` | O3 Mini |

Дополнительно: **Vector Store ID** для поиска по файлам базы знаний через `file_search`.

**DeepSeek (Chat Completions API)**

| Модель | Описание |
|---|---|
| `deepseek-chat` | DeepSeek Chat V3 — быстрый и умный |
| `deepseek-reasoner` | DeepSeek Reasoner R1 — глубокое рассуждение |

База знаний хранится **локально в PostgreSQL** с поиском через RAG.

### Как работает AI-ответчик

1. Входящее сообщение поступает через вебхук Avito
2. Если чат в статусе `BOT` и ассистент настроен — запускается генерация ответа
3. Ассистент получает:
   - Историю последних 20 сообщений чата
   - Имя клиента, название и цену товара
   - Найденные релевантные фрагменты из базы знаний (если настроена)
4. При наличии маркера `[ESCALATE]` в ответе:
   - Чат переводится в статус `MANAGER`
   - Клиенту отправляется прощальное сообщение
5. Ответ отправляется через Avito API и сохраняется в БД

### Настройка промптов

В интерфейсе `/ai-assistant` (глобально) и `/dashboard` (per-user) доступны:

- **Системный промпт** — поведение ассистента, стиль общения, ограничения
- **Промпт эскалации** — условия, при которых ИИ должен передать чат менеджеру

Пример системного промпта:
```
Ты — вежливый менеджер по продажам. Отвечай кратко и по делу.
Помогай клиентам с вопросами о товарах. Всегда говори о наличии и цене.
Если не знаешь ответа — признайся и предложи позвать менеджера.
```

Пример промпта эскалации:
```
Передай диалог менеджеру ([ESCALATE]) если:
- Клиент просит возврат или компенсацию
- Клиент недоволен и конфликтует
- Вопрос требует проверки склада или бухгалтерии
- Клиент хочет оптовую закупку (>10 единиц)
```

### База знаний

**Для OpenAI:**
1. Создайте Vector Store в [OpenAI Platform](https://platform.openai.com/storage/vector_stores)
2. Скопируйте его ID (формат: `vs_xxxxxxxxx`)
3. Вставьте ID в поле «Vector Store ID» в настройках
4. Загрузите файлы через раздел «Файлы Vector Store» в UI CRM

**Для DeepSeek:**
1. Перейдите в `/ai-assistant` → раздел «База знаний»
2. Загрузите файлы через UI (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.html`)
3. Файлы автоматически разбиваются на чанки и индексируются

---

## Управление пользователями

### Регистрация через UI

Перейдите на `/register` и создайте аккаунт. Первый зарегистрированный пользователь может быть назначен администратором вручную.

### Создание пользователя вручную

```bash
cd /var/www/avito-crm

# 1. Сгенерировать хеш пароля
npx tsx scripts/hash-password.ts "МойПароль123"

# 2. Записать в БД
sudo -u postgres psql avito_crm << 'EOF'
INSERT INTO "User" (id, email, "passwordHash", "isActive", role, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'manager@example.com',
  '<хеш-из-шага-1>',
  true,
  'USER',
  NOW(),
  NOW()
);
EOF
```

### Назначение роли ADMIN

```bash
sudo -u postgres psql avito_crm -c "
UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'manager@example.com';
"
```

### Деактивация пользователя

```bash
sudo -u postgres psql avito_crm -c "
UPDATE \"User\" SET \"isActive\" = false WHERE email = 'manager@example.com';
"
```

При деактивации все активные сессии отклоняются при следующем запросе.

### Удаление всех сессий пользователя

```bash
sudo -u postgres psql avito_crm -c "
DELETE FROM \"Session\" WHERE \"userId\" = (SELECT id FROM \"User\" WHERE email = 'manager@example.com');
"
```

### Просмотр через Prisma Studio

```bash
cd /var/www/avito-crm
npx prisma studio
```

---

## Cron-задачи

Оба эндпоинта защищены токеном `CRM_CRON_TOKEN`, который передаётся через query-параметр `?token=`.

### Настройка crontab

```bash
crontab -e
```

Добавьте строки:

```cron
# Дожимы: каждые 5 минут
*/5 * * * * curl -s -X POST "https://your-domain.com/api/cron/followup?token=YOUR_CRON_TOKEN" >> /var/log/avito-crm-followup.log 2>&1

# Синхронизация цен: каждый час
0 * * * * curl -s -X POST "https://your-domain.com/api/cron/sync-prices?token=YOUR_CRON_TOKEN" >> /var/log/avito-crm-prices.log 2>&1
```

> Замените `YOUR_CRON_TOKEN` на значение из `.env` (`CRM_CRON_TOKEN`).

### Эндпоинт дожимов `/api/cron/followup`

**Рекомендуемый интервал:** каждые 5–10 минут

**Логика выполнения:**
1. Находит BOT-чаты, где последнее сообщение от бота было 1–2 часа назад, клиент не ответил, и чат активен в последние 2 часа
2. Отправляет сообщение «Актуален ли ваш заказ?» в каждый такой чат
3. Находит BOT-чаты с дожимом, отправленным более 24 часов назад без ответа клиента
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

### Эндпоинт синхронизации цен `/api/cron/sync-prices`

**Рекомендуемый интервал:** каждые 30 минут — 2 часа

**Логика выполнения:**
1. Загружает все объявления аккаунта через Avito Items API (`/core/v1/items`)
2. Обходит все чаты в БД
3. Для каждого чата извлекает `item_id` из URL объявления
4. Если цена или заголовок изменились — обновляет в БД и публикует SSE-событие

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

## API Reference

Все эндпоинты (кроме `/api/auth/login`, `/api/auth/register`, `/api/avito/webhook`) требуют авторизации через cookie-сессию.

### Аутентификация

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/auth/login` | Вход: `{ email, password }` → устанавливает cookie |
| `POST` | `/api/auth/register` | Регистрация: `{ email, password }` → создаёт пользователя и сессию |
| `POST` | `/api/auth/logout` | Выход: удаляет сессию |
| `GET` | `/api/auth/me` | Данные текущего пользователя |

### Чаты

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/chats` | Список чатов (фильтрация: `?status=BOT`, сортировка: `?sort=price_asc`) |
| `GET` | `/api/chats/[id]/messages` | Сообщения конкретного чата |
| `POST` | `/api/chats/[id]/send` | Отправить сообщение: `{ text }` |
| `POST` | `/api/chats/[id]/read` | Отметить сообщения прочитанными |
| `POST` | `/api/chats/[id]/pin` | Закрепить / открепить чат |
| `POST` | `/api/chats/[id]/finish` | Завершить: перевести в MANAGER |
| `POST` | `/api/chats/[id]/reactivate` | Реактивировать: BOT ← INACTIVE |

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
| `PUT` | `/api/ai-assistant` | Сохранить настройки (только ADMIN) |
| `GET` | `/api/ai-assistant/files` | Список файлов OpenAI Vector Store |
| `POST` | `/api/ai-assistant/files` | Загрузить файл в Vector Store |
| `DELETE` | `/api/ai-assistant/files` | Удалить файл из Vector Store |
| `GET` | `/api/ai-assistant/deepseek-files` | Список файлов локальной базы знаний |
| `POST` | `/api/ai-assistant/deepseek-files` | Загрузить файл в локальную базу |
| `DELETE` | `/api/ai-assistant/deepseek-files` | Удалить файл из локальной базы |

### Cron

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/cron/followup?token=TOKEN` | Дожимы + перевод в INACTIVE |
| `POST` | `/api/cron/sync-prices?token=TOKEN` | Синхронизация цен объявлений |

### Настройки пользователя

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/user/settings` | Получить per-user настройки |
| `PUT` | `/api/user/settings` | Сохранить per-user настройки |

### Realtime

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/events` | SSE-поток событий для realtime-обновлений UI |

### Внешний бот (опционально)

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/bot/reply` | Принять ответ от внешнего n8n-бота |

---

## Mock-режим для разработки

Позволяет разрабатывать и тестировать CRM без реального подключения к Avito API.

```env
MOCK_MODE=true
NEXT_PUBLIC_MOCK_MODE=true
```

В mock-режиме:
- Все исходящие сообщения сохраняются только в БД (не отправляются в Avito)
- Вебхуки принимаются без проверки подписи
- Синхронизация цен пропускается
- Дожимы работают, но сообщения не отправляются в Avito
- Доступны dev-утилиты

### Dev-утилиты (только в mock-режиме)

```bash
# Заполнить БД тестовыми данными
curl -X POST http://localhost:3000/api/dev/seed

# Очистить все чаты и сообщения
curl -X POST http://localhost:3000/api/dev/reset

# Симулировать входящее сообщение
curl -X POST http://localhost:3000/api/dev/incoming \
  -H "Content-Type: application/json" \
  -d '{"avitoChatId": "test_chat_123", "text": "Привет, есть в наличии?"}'

# Проверить текущую сессию
curl http://localhost:3000/api/dev/whoami
```

---

## Обслуживание и мониторинг

### Просмотр логов

```bash
# Логи приложения через PM2
pm2 logs avito-crm

# Логи в реальном времени
pm2 logs avito-crm --raw

# Логи Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Логи cron-задач (если настроено перенаправление)
tail -f /var/log/avito-crm-followup.log
tail -f /var/log/avito-crm-prices.log
```

### Проверка состояния

```bash
# Состояние PM2
pm2 status

# Состояние PostgreSQL
sudo systemctl status postgresql

# Состояние Nginx
sudo systemctl status nginx

# Использование ресурсов
pm2 monit
```

### Резервное копирование БД

```bash
# Создать дамп
sudo -u postgres pg_dump avito_crm > /backup/avito_crm_$(date +%Y%m%d_%H%M%S).sql

# Восстановить из дампа
sudo -u postgres psql avito_crm < /backup/avito_crm_20240101_120000.sql
```

Автоматизированный бэкап через cron:

```bash
crontab -e
# Ежедневный бэкап в 3:00
0 3 * * * sudo -u postgres pg_dump avito_crm > /backup/avito_crm_$(date +\%Y\%m\%d).sql
```

### Ротация логов PM2

```bash
# Установите logrotate для PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### Типичные проблемы

**Вебхуки не приходят от Avito**
- Убедитесь, что приложение доступно по HTTPS
- Проверьте, что вебхук зарегистрирован: `POST /api/avito/subscribe`
- Проверьте логи Nginx на наличие 502 ошибок
- Убедитесь, что PM2 процесс запущен: `pm2 status`

**AI-ассистент не отвечает**
- Проверьте наличие и корректность API-ключа в настройках `/ai-assistant`
- Проверьте баланс на аккаунте OpenAI/DeepSeek
- Посмотрите логи: `pm2 logs avito-crm`

**SSE соединения обрываются**
- Убедитесь, что в конфигурации Nginx установлен `proxy_read_timeout 3600s`
- Добавьте `proxy_buffering off` в конфигурацию Nginx

**Ошибка подключения к PostgreSQL**
- Проверьте `DATABASE_URL` в `.env`
- Убедитесь, что PostgreSQL запущен: `sudo systemctl status postgresql`
- Проверьте права пользователя БД

**Приложение не запускается после обновления**
- Проверьте, применены ли миграции: `npx prisma migrate deploy`
- Пересоберите: `npm run build`
- Проверьте логи: `pm2 logs avito-crm`
