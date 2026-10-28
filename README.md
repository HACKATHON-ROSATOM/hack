# Hackathon workspace

В одном репозитории находятся два независимых приложения:

- `client/` — пустой Nuxt 4 с Tailwind CSS и Nuxt UI (порт 3001).
- `server/` — существующий Express API с Prisma и PostgreSQL (порт 3000).

## Запуск API и подготовка данных через Docker

Нужны Docker Engine и Docker Compose. Команды выполняются из корня репозитория. Исходную книгу `Оборудование для задания.xlsx` возьмите из материалов задания; она не входит в репозиторий. Пример ниже предполагает, что книга находится в каталоге `Приложения` рядом с репозиторием. Подставьте свой путь, сохранив кавычки.

Для чистого checkout сначала создайте каталог для монтирования Prisma Client (команда ниже предназначена для Linux/macOS; в PowerShell используйте `New-Item -ItemType Directory -Force server/src/generated/prisma`):

```sh
mkdir -p server/src/generated/prisma
docker compose up --build --detach --wait
```

Compose запускает PostgreSQL, применяет миграции и затем запускает сервер на `http://localhost:3000`. В контейнере адрес базы задан автоматически; локальный `.env` для этих команд не нужен. Если порты 3000 или 5432 заняты, задайте свободные `HOST_PORT` и `POSTGRES_HOST_PORT` перед запуском и последующими командами Compose.

Создайте демонстрационных пользователей и импортируйте книгу:

```sh
docker compose exec -w /app/server app node scripts/auth-seed.ts
docker compose cp "../Приложения/Оборудование для задания.xlsx" app:/tmp/equipment.xlsx
docker compose exec -w /app/server app node scripts/equipment-import.ts /tmp/equipment.xlsx
```

Ожидаемый отчёт: `equipment: 40`, `history: 1339`, `matched: 441`, `unmatched: 898`. Повторная команда импорта не добавляет дубли. Файл в `/tmp` внутри контейнера временный: после пересоздания контейнера его нужно скопировать снова.

Проверьте вход трёх пользователей и API оборудования:

```sh
docker compose exec -w /app/server app node scripts/auth-smoke.ts
docker compose exec -w /app/server app node scripts/equipment-smoke.ts
```

Для ручной проверки входа выполните запросы ниже. В ответе ожидаются HTTP 200, токен и роли DUTY, ENGINEER и DIRECTOR соответственно. Если задан другой `HOST_PORT`, замените порт в адресе:

```sh
curl -i -H 'Content-Type: application/json' -d '{"login":"duty","password":"demo-duty-2026"}' http://localhost:3000/api/auth/login
curl -i -H 'Content-Type: application/json' -d '{"login":"engineer","password":"demo-engineer-2026"}' http://localhost:3000/api/auth/login
curl -i -H 'Content-Type: application/json' -d '{"login":"director","password":"demo-director-2026"}' http://localhost:3000/api/auth/login
```

Учётные записи предназначены только для демонстрации; ограничения входа указаны в [server/README.md](server/README.md#демонстрационный-вход). Для проверки сохранности данных перезапустите контейнеры командой `docker compose restart`, затем повторите обе проверки. `docker compose down` останавливает и удаляет контейнеры, сохраняя том базы; не используйте `--volumes`, если нужны данные.

## Локальный запуск

Из корня репозитория установите зависимости: `pnpm install --frozen-lockfile`.

- Клиент: `pnpm dev:client`
- Сервер: скопируйте `server/.env.example` в `server/.env`, настройте `DATABASE_URL`, затем выполните `pnpm dev:server`.
- Сборка клиента: `pnpm build:client`
- Сборка сервера: `pnpm build:server`
- Общая проверка: `pnpm verify`

Docker Compose для API запускается из корня: `docker compose up --build`. Подробности настройки API и БД находятся в [server/README.md](server/README.md).

Клиент пока не подключён к API. Его единственная страница намеренно пустая.
