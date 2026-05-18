# ⛽ FleetFuel

Aplikacja webowa do zarządzania flotą pojazdów — tankowania, spalanie, koszty.

## Stack

- **Backend**: Node.js + Express
- **Baza danych**: PostgreSQL
- **Frontend**: Vanilla HTML/CSS/JS (serwowany przez Express)
- **Deploy**: Render.com

---

## Struktura projektu

```
fleetfuel/
├── backend/
│   ├── src/
│   │   ├── index.js              # Serwer Express
│   │   ├── db/init.js            # Połączenie z DB + schemat
│   │   ├── routes/               # vehicles, refuels, stats
│   │   ├── controllers/          # logika biznesowa
│   │   └── middleware/validate.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── render.yaml
└── .gitignore
```

---

## Uruchomienie lokalne

### 1. Wymagania

- Node.js >= 18
- PostgreSQL (lokalnie lub np. [Neon.tech](https://neon.tech) — darmowy plan)

### 2. Klonuj i zainstaluj

```bash
git clone https://github.com/TWOJ_USERNAME/fleetfuel.git
cd fleetfuel/backend
npm install
```

### 3. Utwórz plik `.env`

```bash
cp .env.example .env
```

Uzupełnij `DATABASE_URL`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/fleetfuel
NODE_ENV=development
PORT=3000
```

### 4. Utwórz bazę danych

```bash
createdb fleetfuel
```

### 5. Uruchom serwer

```bash
npm run dev
```

Otwórz: [http://localhost:3000](http://localhost:3000)

---

## Deploy na Render

### Opcja A — Automatyczny (render.yaml)

1. Wrzuć projekt na GitHub
2. Zaloguj się na [render.com](https://render.com)
3. **New** → **Blueprint** → wskaż swoje repo
4. Render automatycznie:
   - tworzy bazę PostgreSQL (`fleetfuel-db`)
   - deployuje serwer Node.js
   - ustawia zmienną `DATABASE_URL`

### Opcja B — Ręczny

1. **New** → **PostgreSQL** → utwórz bazę `fleetfuel-db`
2. **New** → **Web Service** → wskaż repo
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variable: `DATABASE_URL` = Connection String z kroku 1

---

## API Endpoints

### Pojazdy
| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/vehicles` | Lista pojazdów ze statystykami |
| POST | `/api/vehicles` | Dodaj pojazd |
| PUT | `/api/vehicles/:id` | Edytuj pojazd |
| DELETE | `/api/vehicles/:id` | Usuń pojazd (kaskadowo z tankowaniami) |

### Tankowania
| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/refuels` | Lista tankowań (filtry: vehicle_id, fuel_type, month) |
| POST | `/api/refuels` | Dodaj tankowanie |
| PUT | `/api/refuels/:id` | Edytuj tankowanie |
| DELETE | `/api/refuels/:id` | Usuń tankowanie |

### Statystyki
| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/stats/dashboard` | Sumy ogólne |
| GET | `/api/stats/monthly` | Koszty per miesiąc (12m) |
| GET | `/api/stats/vehicles` | Raport per pojazd |

---

## Funkcje

- ✅ Zarządzanie flotą pojazdów (CRUD)
- ✅ Rejestrowanie tankowań z pełnymi danymi
- ✅ Automatyczne obliczanie spalania (L/100km)
- ✅ Dashboard z wykresami miesięcznymi
- ✅ Filtrowanie tankowań (pojazd, paliwo, miesiąc)
- ✅ Raporty per pojazd
- ✅ Eksport do CSV
- ✅ Responsywny UI (mobile-friendly)
