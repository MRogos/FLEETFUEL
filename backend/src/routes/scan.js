const router = require('express').Router();
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Tylko pliki graficzne'));
  }
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Waluty per kraj
const COUNTRY_CURRENCY = {
  PL: 'PLN', DE: 'EUR', NL: 'EUR', BE: 'EUR', FR: 'EUR', GB: 'GBP'
};

// ID stacji Tankpool24 Straelen w Tankerkönig (Heronger Feld 15)
const TANKPOOL_STRAELEN_ID = '005056ba-7cb6-1ed2-bceb-90e360dc0de2';

// Kurs waluty z NBP
async function getRate(currency) {
  if (currency === 'PLN') return { rate: 1.0, date: null };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/?format=json`);
    if (!res.ok) throw new Error('NBP error');
    const data = await res.json();
    return { rate: parseFloat(data.rates[0].mid), date: data.rates[0].effectiveDate };
  } catch {
    const fallback = { EUR: 4.25, GBP: 5.00 };
    return { rate: fallback[currency] || 4.25, date: 'fallback' };
  }
}

// Cena diesla z Tankerkönig dla stacji Straelen
async function getTankpoolDieselPrice() {
  const apiKey = process.env.TANKERKOENIG_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://creativecommons.tankerkoenig.de/api/detail.php?id=${TANKPOOL_STRAELEN_ID}&apikey=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok && data.station && data.station.diesel) {
      return {
        price: parseFloat(data.station.diesel),
        source: 'Tankpool24 Straelen (Tankerkönig)',
        isOpen: data.station.isOpen,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Pobierz cenę diesla przez Claude web search
async function getDieselPriceViaSearch(country) {
  try {
    const locations = {
      DE: 'Straelen Germany diesel price today EUR per liter',
      NL: 'Netherlands diesel price today EUR per liter',
      BE: 'Belgium diesel price today EUR per liter',
      FR: 'France diesel price today EUR per liter',
      GB: 'UK diesel price today GBP per liter',
      PL: 'Polska cena diesla dzis PLN za litr',
    };
    const query = locations[country] || locations['DE'];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 512,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `${query}. Odpowiedz TYLKO jedną liczbą - aktualną cenę diesla za litr w walucie lokalnej (np. 1.85). Bez tekstu, tylko liczba.`
        }]
      })
    });

    const data = await response.json();
    console.log('Web search response:', JSON.stringify(data).slice(0, 500));
    // Zbierz wszystkie bloki tekstowe
    const texts = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ');
    // Szukaj liczby w formacie ceny (1.xx lub 1,xx)
    const match = texts.match(/\b([12][\.\,]\d{2,3})\b/);
    if (match) {
      const price = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(price) && price > 0.8 && price < 3.5) {
        return {
          price,
          source: `Cena rynkowa ${country} (web search)`,
        };
      }
    }
    console.log('Nie znaleziono ceny w:', texts.slice(0, 200));
    return null;
  } catch {
    return null;
  }
}

// Skanowanie zdjęć
router.post('/', upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Brak zdjęć' });
    }

    const country = req.body.country || 'DE';
    const useTankpool = req.body.use_tankpool === 'true';
    const currency = COUNTRY_CURRENCY[country] || 'EUR';

    const imageContents = req.files.map(file => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimetype,
        data: file.buffer.toString('base64'),
      }
    }));

    const currencyHint = currency === 'PLN'
      ? 'Ceny są w PLN.'
      : `Ceny są w ${currency}. Podaj wartości w oryginalnej walucie ${currency}, nie przeliczaj do PLN.`;

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          {
            type: 'text',
            text: `Przeanalizuj te zdjęcia z tankowania ciężarówki/samochodu dostawczego. ${currencyHint}

Wyciągnij DOKŁADNIE:
- mileage: przebieg z licznika km (liczba całkowita, czytaj uważnie każdą cyfrę)
- liters: ilość paliwa w litrach z dystrybutora (liczba dziesiętna, czytaj uważnie)
- price_per_l: cena za litr w ${currency} (liczba, null jeśli dystrybutor Tankpool - brak ceny)
- total: łączna kwota w ${currency} (liczba, null jeśli brak)
- fuel_type: rodzaj paliwa - domyślnie ON (diesel) jeśli nie widać inaczej
- station: nazwa stacji jeśli widoczna (np. Tankpool, Aral, Shell)
- has_price: true jeśli cena widoczna na zdjęciu, false jeśli brak

KLUCZOWE ZASADY ODCZYTU:
1. Dystrybutory Tokheim mają wyświetlacze LCD gdzie GÓRNY SEGMENT cyfry 7 jest często NIEWIDOCZNY - wygląda jak 1. Jeśli widzisz "1X,XX LITER" gdzie X > 0, rozważ czy to nie jest "7X,XX".
2. Dla ciężarówek/dostawczaków typowe tankowanie to 50-200 litrów. Jeśli odczytujesz mniej niż 20L dla dużego pojazdu - prawdopodobnie pierwsza cyfra to 7 lub inny segment jest niewidoczny.
3. Litry: czytaj jako liczbę dziesiętną (np. 73.54, 125.40)
4. Przebieg: 6-cyfrowa liczba całkowita (np. 970050)
5. Jeśli widzisz "13,54 LITER" na Tokheim - podaj liters: 73.54 (7 z ukrytym segmentem)
6. Odpowiedz TYLKO JSON, zero tekstu poza JSON.
Przykład: {"mileage": 970050, "liters": 73.54, "price_per_l": null, "total": null, "fuel_type": "ON", "station": "Tokheim", "has_price": false}`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    let scanned = {};
    try {
      scanned = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch { scanned = {}; }

    // Pobierz kurs waluty
    const rateInfo = await getRate(currency);
    const rate = rateInfo.rate;

    // Jeśli brak ceny i to Tankpool/Niemcy → pobierz z Tankerkönig
    let tankpoolPrice = null;
    let priceSource = null;

    if (!scanned.price_per_l && !scanned.total && (useTankpool || scanned.has_price === false)) {
      // Najpierw próbuj konkretną stację Tankpool Straelen
      tankpoolPrice = await getTankpoolDieselPrice();
      if (!tankpoolPrice) {
        // Fallback: średnia okolicy
        tankpoolPrice = await getDieselPriceViaSearch(country);
      }
      if (tankpoolPrice) {
        scanned.price_per_l = tankpoolPrice.price;
        priceSource = tankpoolPrice.source;
      }
    }

    // Przelicz na PLN
    const price_per_l_pln = scanned.price_per_l ? Math.round(scanned.price_per_l * rate * 1000) / 1000 : null;
    const total_orig = scanned.total;
    const total_pln = total_orig ? Math.round(total_orig * rate * 100) / 100 : null;
    const calc_total = total_pln || (price_per_l_pln && scanned.liters
      ? Math.round(price_per_l_pln * scanned.liters * 100) / 100
      : null);

    res.json({
      ok: true,
      data: {
        mileage: scanned.mileage || null,
        liters: scanned.liters || null,
        price_per_l: price_per_l_pln,
        total: calc_total,
        fuel_type: scanned.fuel_type || 'ON',
        station: scanned.station || null,
      },
      meta: {
        country,
        currency,
        rate,
        rate_date: rateInfo.date,
        price_source: priceSource,
        price_auto_fetched: !!tankpoolPrice,
        original: {
          price_per_l: scanned.price_per_l,
          total: total_orig,
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint: aktualny kurs waluty
router.get('/rate/:currency', async (req, res, next) => {
  try {
    const info = await getRate(req.params.currency.toUpperCase());
    res.json(info);
  } catch (err) { next(err); }
});

// Endpoint: aktualna cena diesla Straelen
router.get('/diesel-price', async (req, res, next) => {
  try {
    const country = req.query.country || "DE";
    const price = await getTankpoolDieselPrice() || await getDieselPriceViaSearch(country);
    res.json(price || { error: 'Brak klucza Tankerkönig lub brak danych' });
  } catch (err) { next(err); }
});

module.exports = router;
