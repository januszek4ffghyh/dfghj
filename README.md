# Margonem AutoWalk Bot — split architecture

Bot podzielony na lekki loader Tampermonkey (UI + bridge DOM) oraz hostowaną logikę (`bot-core.js`) i dane map (`maps.json`).

## Struktura plików

```
danessi/
├── tampermonkey/
│   └── loader.user.js      # Userscript — instaluj w Tampermonkey
├── hosted/
│   ├── bot-core.js         # Logika bota (mainLoop, Auto-F, state machine)
│   └── maps.json           # ~2718 map (id, name, slug) z MargoWorld
├── dashboard/
│   ├── index.html          # Web dashboard (tryb DEV)
│   ├── style.css
│   └── app.js
├── scripts/
│   ├── dev-server.js       # Lokalny serwer statyczny + API stanu
│   └── parse-idmap.js      # Regeneracja maps.json z IDMAP .txt
├── package.json
├── IDMAP .txt              # Źródło listy map (MargoWorld scrape)
└── KDO BOTA.JS             # Oryginalny monolit (referencja)
```

## Architektura

| Warstwa | Plik | Odpowiedzialność |
|---------|------|------------------|
| Loader | `loader.user.js` | Panel UI, CSS, timery render, bridge DOM (`heroGoTo`, `scanMobs`, CAPTCHA…) |
| Core | `bot-core.js` | `mainLoop`, `checkArrival`, filtrowanie mobów, Auto-F (decyzje przez bridge) |
| Dane | `maps.json` | Słownik map `{ "77": { id, name, slug } }`, cache w `GM_setValue` |
| Dashboard | `dashboard/` | Live podgląd stanu bota (tylko tryb DEV) |
| Dev server | `dev-server.js` | Serwuje `hosted/`, dashboard i `POST/GET /api/state` |

**Bridge:** core wywołuje `bridge.scanMobs()`, `bridge.heroGoTo()` itd. — zero `fetch` w `mainLoop` / `checkArrival`.

Telemetry w trybie DEV działa na **osobnym interwale** (co 2 s), nie w pętli bota.

---

## Tryb DEV — localhost (testowanie lokalne)

Lokalne testowanie bez GitHub/CDN + web dashboard ze statystykami na żywo.

### Krok 1: Uruchom serwer deweloperski

```bash
npm run dev
```

lub:

```bash
node scripts/dev-server.js
```

Serwer startuje na **http://127.0.0.1:3847** i serwuje:

| URL | Zawartość |
|-----|-----------|
| `http://127.0.0.1:3847/` | Dashboard |
| `http://127.0.0.1:3847/hosted/bot-core.js` | Logika bota |
| `http://127.0.0.1:3847/hosted/maps.json` | Dane map |
| `http://127.0.0.1:3847/api/state` | API stanu bota (GET/POST) |

Port można zmienić: `MAW_DEV_PORT=4000 node scripts/dev-server.js`

### Krok 2: Włącz tryb DEV w loaderze

Otwórz `tampermonkey/loader.user.js` i ustaw:

```javascript
const DEV = true;  // włącza localhost
```

Alternatywnie (bez edycji pliku): w konsoli Tampermonkey / GM:

```javascript
GM_setValue('maw_dev_mode', true);
```

### Krok 3: Zainstaluj loader w Tampermonkey

1. Tampermonkey → **Utwórz nowy skrypt**
2. Wklej zawartość `tampermonkey/loader.user.js`
3. Zapisz

### Krok 4: Otwórz grę

1. Wejdź na `https://*.margonem.pl`
2. Loader pobierze `bot-core.js` i `maps.json` z localhost
3. W panelu bota pojawi się znacznik **DEV**

### Krok 5: Otwórz dashboard

W przeglądarce: **http://127.0.0.1:3847/**

Dashboard pokazuje na żywo:

- Bohater (nazwa, poziom, HP%)
- Mapa (nazwa z `maps.json`, ID, slug)
- Złoto (aktualne, zysk sesji, tempo/h)
- EXP (postęp, tempo, czas do lvl)
- Status bota (faza, cel, lista mobów)
- Torba i potki
- Umiejętności
- Auto-F i CAPTCHA
- Konfiguracja bota

Gdy bot nie wysyła danych, dashboard wyświetla **„Brak połączenia”**.

### Mixed content (HTTPS → HTTP)

Margonem działa na HTTPS, a serwer dev na HTTP. Przeglądarka może blokować żądania do `http://127.0.0.1`.

**Rozwiązania:**

- Chrome: klik ikonę „Niezabezpieczona” przy adresu → **Ustawienia witryny** → **Niezabezpieczone treści** → **Zezwól**
- Firefox: zezwól na mixed content dla margonem.pl
- Edge: podobnie jak Chrome

Tampermonkey wymaga `@connect 127.0.0.1` i `@connect localhost` (już dodane w loaderze).

### Powrót do produkcji (CDN)

```javascript
const DEV = false;
```

i ustaw `PROD_HOST` na URL jsDelivr:

```javascript
const PROD_HOST = 'https://cdn.jsdelivr.net/gh/TWOJ_USER/TWOJE_REPO@main/hosted/';
```

---

## Wdrożenie produkcyjne (CDN)

### 1. Hostowanie plików

1. Utwórz repozytorium GitHub i wgraj folder `hosted/` (z `bot-core.js` i `maps.json`).
2. W `tampermonkey/loader.user.js` ustaw `PROD_HOST` na URL jsDelivr, np.:

   ```javascript
   const PROD_HOST = 'https://cdn.jsdelivr.net/gh/TWOJ_USER/TWOJE_REPO@main/hosted/';
   ```

3. Po zmianie `maps.json` podnieś `MAPS_VERSION` w loaderze (wymusza odświeżenie cache GM).
4. Po zmianie `bot-core.js` podnieś `CORE_VERSION` (query string przy ładowaniu skryptu).

### 2. Instalacja userscripta

1. Otwórz Tampermonkey → **Utwórz nowy skrypt**.
2. Wklej zawartość `tampermonkey/loader.user.js`.
3. Zapisz i wejdź na `https://*.margonem.pl`.

Przy pierwszym uruchomieniu loader pobierze `maps.json` (zapisze w `GM_setValue`) i `bot-core.js` (raz na sesję).

### 3. Regeneracja maps.json

```bash
npm run parse-maps
```

lub:

```bash
node scripts/parse-idmap.js
```

Czyta `IDMAP .txt`, zapisuje `hosted/maps.json`.

## Wersjonowanie cache

- `MAPS_CACHE_KEY = 'maw_maps_v' + MAPS_VERSION` — dane map w storage Tampermonkey
- `bot-core.js?v=CORE_VERSION` — bust cache przeglądarki
- W trybie DEV cache `maps.json` jest pomijany (zawsze pobiera z localhost)

## Uwagi

- Oryginalna funkcjonalność z `KDO BOTA.JS` zachowana; logika przeniesiona do core, DOM zostaje w loaderze.
- `maps.json` jest gotowy pod przyszłe auto-chodzenie między mapami (lookup po ID).
- Przy ~2719 wpisach w IDMAP parser zapisuje ~2718 unikalnych ID (jeden duplikat w źródle).
- Dashboard jest tylko do dev — nie jest potrzebny przy wdrożeniu CDN.
