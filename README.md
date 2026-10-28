# Hackathon workspace

В одном репозитории находятся два независимых приложения:

- `client/` — пустой Nuxt 4 с Tailwind CSS и Nuxt UI (порт 3001).
- `server/` — существующий Express API с Prisma и PostgreSQL (порт 3000).

## Локальный запуск

Из корня репозитория установите зависимости: `pnpm install --frozen-lockfile`.

- Клиент: `pnpm dev:client`
- Сервер: скопируйте `.env.example` в `server/.env`, настройте `DATABASE_URL`, затем выполните `pnpm dev:server`.
- Сборка клиента: `pnpm build:client`
- Сборка сервера: `pnpm build:server`
- Общая проверка: `pnpm verify`

Docker Compose для API запускается из корня: `docker compose up --build`. Подробности настройки API и БД находятся в [server/README.md](server/README.md).

Клиент пока не подключён к API. Его единственная страница намеренно пустая.
