# Развёртывание Apps Script (делаешь сам, ~5 минут)

1. Открой таблицу «Gym Log» → **Расширения → Apps Script**.
2. Удали всё в `Code.gs` и вставь содержимое `apps-script/Code.gs` из этого репозитория. Сохрани (Ctrl/Cmd+S).
3. Слева **Project Settings (шестерёнка) → Script Properties → Add script property**:
   `GYM_SECRET` = длинная случайная строка (например, сгенерируй: `openssl rand -hex 24`). Сохрани.
4. **Deploy → New deployment** → тип **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (доступ по ссылке; без секрета скрипт ничего не отдаёт и не пишет)
   → **Deploy**, разреши доступ к таблице (Advanced → Go to … → Allow).
5. Скопируй **Web app URL** (оканчивается на `/exec`).
6. В приложении: **Настройки → URL веб-приложения** и **Общий секрет** → «Проверить связь» → «Обновить программу».

После правок `Code.gs`: **Deploy → Manage deployments → карандаш → Version: New version → Deploy** (URL не меняется).
URL и секрет хранятся только на телефоне, в репозиторий их не клади.
