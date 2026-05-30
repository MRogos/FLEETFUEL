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

const COUNTRY_CURRENCY = {
  PL: 'PLN', DE: 'EUR', NL: 'EUR', BE: 'EUR', FR: 'EUR', GB: 'GBP'
};

// Kurs waluty z NBP
async function getRate(currency) {
  if (currency === 'PLN') return { rate: 1.0, date: null };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/?format=json`);
    if (!res.ok) throw new Error('NBP error');
    const data = await res.json();
    return { rate: parseFloat(data.rates[0].mid), date: data.rates[0].effectiveDate };
  } catch {
    return { rate: currency === 'EUR' ? 4.25 : 5.00, date: 'fallback' };
  }
}

// Cena diesla z konkretnych zrodel per kraj
async function getDieselPrice(country) {
  try {
    switch(country) {

      case 'PL': {
        // cenypaliw.fyi - oficjalne dane Orlen, codziennie aktualizowane
        const res = await fetch('https://cenypaliw.fyi/', {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
        });
        const html = await res.text();
        // Szukaj ceny ON z VAT
        const match = html.match(/ON[^0-9]*?([5-9]\.[0-9]{2})/i) ||
                      html.match(/diesel[^0-9]*?([5-9]\.[0-9]{2})/i) ||
                      html.match(/([5-9]\.[0-9]{2})[^0-9]*?PLN[^0-9]*?VAT/i);
        if (match) {
          const price = parseFloat(match[1]);
          if (price > 5 && price < 10) {
            return { price, source: 'Orlen PL (cenypaliw.fyi)' };
          }
        }
        // Fallback - szukaj jakiejkolwiek sensownej ceny
        const prices = [...html.matchAll(/([5-9]\.[0-9]{2})/g)].map(m => parseFloat(m[1])).filter(p => p > 5.5 && p < 9);
        if (prices.length) {
          return { price: prices[0], source: 'Orlen PL (cenypaliw.fyi)' };
        }
        return { price: 6.89, source: 'Orlen PL (wartosc orientacyjna)' };
      }

      case 'DE': {
        // Tankerkoenig API jesli mamy klucz, inaczej fuel-prices.eu
        const apiKey = process.env.TANKERKOENIG_API_KEY;
        if (apiKey) {
          const tankpoolId = '005056ba-7cb6-1ed2-bceb-90e360dc0de2';
          const res = await fetch(`https://creativecommons.tankerkoenig.de/api/detail.php?id=${tankpoolId}&apikey=${apiKey}`);
          const data = await res.json();
          if (data.ok && data.station && data.station.diesel) {
            return { price: parseFloat(data.station.diesel), source: 'Tankpool24 Straelen (Tankerkoenig)' };
          }
          // Fallback - okolica Straelen
          const res2 = await fetch(`https://creativecommons.tankerkoenig.de/api/list.php?lat=51.4397&lng=6.2617&rad=5&sort=price&type=diesel&apikey=${apiKey}`);
          const data2 = await res2.json();
          if (data2.ok && data2.stations && data2.stations.length) {
            const prices = data2.stations.map(s => s.price).filter(p => p > 0);
            const avg = prices.reduce((a,b) => a+b) / prices.length;
            return { price: Math.round(avg * 1000) / 1000, source: `Srednia Straelen DE (${prices.length} stacji)` };
          }
        }
        // fuel-prices.eu - dane z MTS-K Niemcy
        const res3 = await fetch('https://www.fuel-prices.eu/live/germany/', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html3 = await res3.text();
        const match3 = html3.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match3) {
          const price = parseFloat(match3[1]);
          if (price > 1.2 && price < 2.5) return { price, source: 'Srednia DE (fuel-prices.eu)' };
        }
        return { price: 1.65, source: 'Niemcy DE (wartosc orientacyjna)' };
      }

      case 'FR': {
        // fuel-prices.eu/live/france - dane rządowe Francja
        const res = await fetch('https://www.fuel-prices.eu/live/france/', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i) ||
                      html.match(/([2]\.[0-9]{2,3})[^0-9]*?Diesel/i);
        if (match) {
          const price = parseFloat(match[1]);
          if (price > 1.5 && price < 2.5) return { price, source: 'TotalEnergies/Srednia FR (fuel-prices.eu)' };
        }
        return { price: 2.08, source: 'Francja FR (wartosc orientacyjna)' };
      }

      case 'GB': {
        // fuel-prices.eu/live/uk - dane UK Gov
        const res = await fetch('https://www.fuel-prices.eu/live/uk/', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i) ||
                      html.match(/GBP[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) {
          const price = parseFloat(match[1]);
          if (price > 1.2 && price < 2.5) return { price, source: 'Srednia UK (fuel-prices.eu / Gov data)' };
        }
        // Konwertuj pence na GBP
        const matchP = html.match(/([1-9][0-9]{2,3})[^0-9]*?p[^a-z]/i);
        if (matchP) {
          const pence = parseFloat(matchP[1]);
          if (pence > 100 && pence < 250) return { price: Math.round(pence) / 100, source: 'UK (fuel-prices.eu)' };
        }
        return { price: 1.84, source: 'Wielka Brytania UK (wartosc orientacyjna)' };
      }

      case 'NL': {
        const res = await fetch('https://www.fuel-prices.eu/live/netherlands/', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) {
          const price = parseFloat(match[1]);
          if (price > 1.3 && price < 2.5) return { price, source: 'Srednia NL (fuel-prices.eu)' };
        }
        return { price: 1.72, source: 'Holandia NL (wartosc orientacyjna)' };
      }

      case 'BE': {
        const res = await fetch('https://www.fuel-prices.eu/live/belgium/', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) {
          const price = parseFloat(match[1]);
          if (price > 1.3 && price < 2.5) return { price, source: 'Srednia BE (fuel-prices.eu)' };
        }
        return { price: 1.68, source: 'Belgia BE (wartosc orientacyjna)' };
      }

      default:
        return null;
    }
  } catch(e) {
    console.error('getDieselPrice error:', country, e.message);
    const fallback = { PL: 6.89, DE: 1.65, FR: 2.08, GB: 1.84, NL: 1.72, BE: 1.68 };
    return fallback[country] ? { price: fallback[country], source: country + ' (wartosc orientacyjna)' } : null;
  }
}

// Tankerkoenig ID dla Tankpool24 Straelen
const TANKPOOL_STRAELEN_ID = '005056ba-7cb6-1ed2-bceb-90e360dc0de2';

// Skanowanie zdjec
router.post('/', upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Brak zdjec' });
    }

    const country = req.body.country || 'DE';
    const useTankpool = req.body.use_tankpool === 'true';
    const currency = COUNTRY_CURRENCY[country] || 'EUR';

    const imageContents = req.files.map(file => ({
      type: 'image',
      source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') }
    }));

    const currencyHint = currency === 'PLN'
      ? 'Ceny sa w PLN.'
      : `Ceny sa w ${currency}. Podaj wartosci w oryginalnej walucie ${currency}.`;

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          {
            type: 'text',
            text: `Przeanalizuj te zdjecia z tankowania. ${currencyHint}

Wyciagnij DOKLADNIE:
- mileage: przebieg z licznika (liczba calkowita)
- liters: ilosc paliwa w litrach (UWAGA: na dystrybutorach Tokheim gorny segment cyfry 7 bywa niewidoczny i wyglada jak 1 - jesli widzisz np. 13.54L na duzym pojeździe, rozważ ze to 73.54L)
- price_per_l: cena za litr w ${currency} (null jesli brak - np. Tankpool nie pokazuje ceny)
- total: laczna kwota w ${currency} (null jesli brak)
- fuel_type: rodzaj paliwa (domyslnie ON/diesel)
- station: nazwa stacji (np. Tankpool, Aral, Orlen, TotalEnergies)
- has_price: true jesli cena widoczna, false jesli brak

Odpowiedz TYLKO JSON:
{"mileage": 970050, "liters": 73.54, "price_per_l": null, "total": null, "fuel_type": "ON", "station": "Tankpool", "has_price": false}`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    let scanned = {};
    try {
      scanned = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch(e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) { try { scanned = JSON.parse(match[0]); } catch(e2) {} }
    }

    // Pobierz kurs
    const rateInfo = await getRate(currency);
    const rate = rateInfo.rate;

    // Pobierz cene jesli brak na dystrybutorze (karta paliwowa - kazdy kraj)
    let priceInfo = null;
    if (!scanned.price_per_l && !scanned.total && (useTankpool || scanned.has_price === false)) {
      console.log('Pobieranie ceny dla kraju:', country);
      priceInfo = await getDieselPrice(country);
      if (priceInfo) {
        scanned.price_per_l = priceInfo.price;
      }
    }

    // Przelicz na PLN
    const price_per_l_pln = scanned.price_per_l
      ? Math.round(scanned.price_per_l * rate * 1000) / 1000
      : null;
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
        country, currency, rate,
        rate_date: rateInfo.date,
        price_source: priceInfo ? priceInfo.source : null,
        price_auto_fetched: !!priceInfo,
        original: { price_per_l: scanned.price_per_l, total: total_orig }
      }
    });
  } catch(err) { next(err); }
});

// Endpoint: aktualna cena diesla dla kraju
router.get('/diesel-price/:country', async (req, res, next) => {
  try {
    const country = req.params.country.toUpperCase();
    const currency = COUNTRY_CURRENCY[country] || 'EUR';
    const priceInfo = await getDieselPrice(country);
    const rateInfo = await getRate(currency);
    res.json({
      country, currency,
      price_local: priceInfo ? priceInfo.price : null,
      price_pln: priceInfo ? Math.round(priceInfo.price * rateInfo.rate * 100) / 100 : null,
      source: priceInfo ? priceInfo.source : 'brak danych',
      rate: rateInfo.rate,
      rate_date: rateInfo.date,
    });
  } catch(err) { next(err); }
});

// Endpoint: kurs waluty
router.get('/rate/:currency', async (req, res, next) => {
  try {
    const info = await getRate(req.params.currency.toUpperCase());
    res.json(info);
  } catch(err) { next(err); }
});

module.exports = router;
