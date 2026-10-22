# Сервер для друзей (Firebase)

1. console.firebase.google.com → Create a project → `sunny-home`, Google Analytics — выключить.
2. Build → Authentication → Get started → Sign-in method → **Anonymous** → Enable → Save.
3. Build → Realtime Database → Create Database → **Belgium (europe-west1)** → **Start in locked mode** → Enable. Скопировать адрес базы (`https://…firebasedatabase.app`).
4. Project settings (шестерёнка) → Your apps → **</>** (Web) → nickname `sunny-home-web`, без Hosting → Register app → скопировать `firebaseConfig` целиком (если нет `databaseURL` — дописать адрес из п. 3).
5. Authentication → Settings → Authorized domains: должен быть `localhost` (для APK) и домен сайта, если игра будет на сайте.
6. Правила базы: Realtime Database → вкладка **Rules** → стереть всё → вставить содержимое `docs/firebase-rules.json` → **Publish**.

`apiKey` — не секрет (это адрес проекта, он лежит в игре). Данные защищают правила базы.
Бесплатный тариф Spark: до 100 одновременных подключений, 1 ГБ данных, карта не нужна.

## Друзья работают только с сайта (https), не из файла

Открытая как файл (file://) игра не может нормально подключиться к Firebase: на телефоне не проходит вход, на компьютере не отвечает база.
Игра выкладывается на GitHub Pages: https://artemionov123.github.io/sunny-home/ (workflow `.github/workflows/pages.yml`, только `dist/sunny-home.html`; студия на сайт не попадает).
Один раз: GitHub → репозиторий → Settings → Pages → Source: **GitHub Actions**. В Firebase → Authentication → Settings → Authorized domains добавить `artemionov123.github.io`.
