/* ─────────────────────────────────────────
   FleetFuel — Frontend App
   ───────────────────────────────────────── */

const API = '/api';

// ─── UTILS ───────────────────────────────
const $ = id => document.getElementById(id);
const fmtNum = (n, dec = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('pl-PL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtDate = d => { if (!d) return '—'; const [y,m,day] = d.slice(0,10).split('-'); return `${day}.${m}.${y}`; };

function showToast(msg, dur = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || JSON.stringify(json.errors));
  return json;
}

function fuelBadge(type) {
  return `<span class="badge badge-fuel"><span class="fuel-dot fuel-${type}"></span>${type}</span>`;
}

function consBadge(val) {
  if (val == null) return '—';
  const v = parseFloat(val);
  const cls = v > 12 ? 'badge-warn' : v < 7 ? 'badge-ok' : 'badge-fuel';
  return `<span class="badge ${cls}">${fmtNum(v,1)} L/100</span>`;
}

// ─── NAVIGATION ──────────────────────────
const sections = ['dashboard', 'vehicles', 'refuels', 'reports'];
const navBtns = document.querySelectorAll('nav button');

function showSection(name) {
  sections.forEach(s => $(`section-${s}`).classList.toggle('active', s === name));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.section === name));
  if (name === 'dashboard') loadDashboard();
  if (name === 'vehicles')  loadVehicles();
  if (name === 'refuels')   loadRefuels();
  if (name === 'reports')   loadReports();
}

navBtns.forEach(b => b.addEventListener('click', () => showSection(b.dataset.section)));

// ─── FLEET COUNT ─────────────────────────
async function updateFleetCount() {
  try {
    const data = await api('GET', '/stats/dashboard');
    const n = data.vehicle_count;
    const suffix = n === 1 ? 'POJAZD' : n < 5 ? 'POJAZDY' : 'POJAZDÓW';
    $('fleet-count').textContent = `${n} ${suffix}`;
  } catch {}
}

// ─── DASHBOARD ───────────────────────────
async function loadDashboard() {
  try {
    const [dash, monthly, perVehicle, refuels] = await Promise.all([
      api('GET', '/stats/dashboard'),
      api('GET', '/stats/monthly'),
      api('GET', '/stats/vehicles'),
      api('GET', '/refuels'),
    ]);

    $('dash-vehicles').textContent = fmtNum(dash.vehicle_count);
    $('dash-refuels').textContent  = fmtNum(dash.refuel_count);
    $('dash-liters').textContent   = fmtNum(dash.total_liters, 2);
    $('dash-cost').textContent     = fmtNum(dash.total_cost, 2);

    // Monthly bar chart
    const chartEl = $('monthly-chart');
    if (!monthly.length) {
      chartEl.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div>Brak danych</div></div>';
    } else {
      const max = Math.max(...monthly.map(m => m.total_cost));
      chartEl.innerHTML = monthly.map(m => {
        const h = max > 0 ? Math.max(4, (m.total_cost / max) * 100) : 4;
        const label = m.month.slice(5) + '/' + m.month.slice(2,4);
        return `<div class="bar-wrap">
          <div class="bar-val">${fmtNum(m.total_cost, 0)}</div>
          <div class="bar" style="height:${h}%" title="${fmtNum(m.total_cost,2)} PLN"></div>
          <div class="bar-label">${label}</div>
        </div>`;
      }).join('');
    }

    // Consumption chart
    const consEl = $('consumption-chart');
    const withCons = perVehicle.filter(v => v.avg_consumption != null);
    if (!withCons.length) {
      consEl.innerHTML = '<div class="empty"><div class="empty-icon">⛽</div><div>Brak danych</div></div>';
    } else {
      const maxC = Math.max(...withCons.map(v => parseFloat(v.avg_consumption)));
      consEl.innerHTML = withCons.map(v => `
        <div class="cons-row">
          <div class="cons-name" title="${v.name}">${v.name.split(' ').slice(-1)[0]}</div>
          <div class="cons-bar-bg"><div class="cons-bar-fill" style="width:${(parseFloat(v.avg_consumption)/maxC*100).toFixed(1)}%"></div></div>
          <div class="cons-val">${fmtNum(v.avg_consumption,1)} L</div>
        </div>
      `).join('');
    }

    // Recent refuels
    const recent = refuels.slice(0, 8);
    const tbody = $('dash-refuels-table');
    if (!recent.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">⛽</div><div>Brak tankowań</div></div></td></tr>';
    } else {
      tbody.innerHTML = recent.map(r => `
        <tr>
          <td class="mono">${fmtDate(r.date)}</td>
          <td><div class="vehicle-name">${r.vehicle_name}</div><div class="vehicle-plate">${r.vehicle_plate}</div></td>
          <td>${fuelBadge(r.fuel_type)}</td>
          <td class="mono">${fmtNum(r.liters,2)} L</td>
          <td class="mono">${r.price_per_l ? fmtNum(r.price_per_l,3)+' zł' : '—'}</td>
          <td class="mono">${r.total ? fmtNum(r.total,2)+' zł' : '—'}</td>
          <td class="mono">${r.mileage ? fmtNum(r.mileage)+' km' : '—'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('❌ Błąd ładowania dashboardu');
    console.error(err);
  }
}

// ─── VEHICLES ────────────────────────────
async function loadVehicles() {
  const grid = $('vehicles-grid');
  grid.innerHTML = '<div class="loading">Ładowanie...</div>';
  try {
    const vehicles = await api('GET', '/vehicles');
    if (!vehicles.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🚗</div><div>Brak pojazdów. Dodaj pierwszy pojazd do floty.</div></div>';
      return;
    }
    grid.innerHTML = vehicles.map(v => `
      <div class="vehicle-card">
        <div class="vc-header">
          <div>
            <div class="vc-name">${v.name}</div>
            <div style="color:var(--text3);font-size:11px;margin-top:2px">${v.year || ''} · ${fuelBadge(v.fuel_type)}</div>
          </div>
          <div class="vc-plate">${v.plate}</div>
        </div>
        <div class="vc-stats">
          <div><div class="vc-stat-label">Tankowania</div><div class="vc-stat-val">${v.refuel_count}</div></div>
          <div><div class="vc-stat-label">Litry</div><div class="vc-stat-val">${fmtNum(v.total_liters,0)}</div></div>
          <div><div class="vc-stat-label">Koszt PLN</div><div class="vc-stat-val">${fmtNum(v.total_cost,0)}</div></div>
          <div><div class="vc-stat-label">Przebieg</div><div class="vc-stat-val">${v.last_mileage ? fmtNum(v.last_mileage) : (v.mileage ? fmtNum(v.mileage) : '—')}</div></div>
          <div><div class="vc-stat-label">VIN/Nr</div><div class="vc-stat-val" style="font-size:10px;color:var(--text3)">${v.vin || '—'}</div></div>
          <div><div class="vc-stat-label">Rok</div><div class="vc-stat-val">${v.year || '—'}</div></div>
        </div>
        <div class="vc-actions">
          <button class="btn-ghost" style="flex:1;text-align:center;font-size:11px" onclick="gotoVehicleRefuels(${v.id})">Historia tankowań</button>
          <button class="btn-edit" onclick="openVehicleModal(${v.id})">✏️</button>
          <button class="btn-danger" onclick="deleteVehicle(${v.id})">✕</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<div class="empty">Błąd ładowania danych.</div>';
    console.error(err);
  }
}

function gotoVehicleRefuels(vehicleId) {
  showSection('refuels');
  setTimeout(() => {
    $('filter-vehicle').value = vehicleId;
    loadRefuels();
  }, 50);
}

// ─── REFUELS ─────────────────────────────
async function loadRefuels() {
  await populateVehicleSelect('filter-vehicle', true);
  await populateVehicleSelect('r-vehicle', false);

  const params = new URLSearchParams();
  const fv = $('filter-vehicle').value;
  const ff = $('filter-fuel').value;
  const fm = $('filter-month').value;
  if (fv) params.set('vehicle_id', fv);
  if (ff) params.set('fuel_type', ff);
  if (fm) params.set('month', fm);

  const tbody = $('refuels-table');
  tbody.innerHTML = '<tr><td colspan="10"><div class="loading">Ładowanie...</div></td></tr>';

  try {
    const refuels = await api('GET', `/refuels?${params}`);
    if (!refuels.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty"><div class="empty-icon">⛽</div><div>Brak wyników dla wybranych filtrów.</div></div></td></tr>';
      return;
    }

    // Calculate per-refuel consumption (compare with previous for same vehicle)
    const byVehicle = {};
    refuels.forEach(r => { (byVehicle[r.vehicle_id] = byVehicle[r.vehicle_id] || []).push(r); });

    tbody.innerHTML = refuels.map(r => {
      const vArr = (byVehicle[r.vehicle_id] || []).filter(x => x.mileage).sort((a,b) => a.mileage-b.mileage);
      let cons = null;
      if (r.mileage) {
        const idx = vArr.findIndex(x => x.id === r.id);
        if (idx > 0) {
          const dist = r.mileage - vArr[idx-1].mileage;
          if (dist > 0) cons = parseFloat(r.liters) / dist * 100;
        }
      }
      return `
        <tr>
          <td class="mono">${fmtDate(r.date)}</td>
          <td><div class="vehicle-name" style="font-size:12px">${r.vehicle_name}</div><div class="vehicle-plate">${r.vehicle_plate}</div></td>
          <td>${fuelBadge(r.fuel_type)}</td>
          <td class="mono">${fmtNum(r.liters,2)} L</td>
          <td class="mono">${r.price_per_l ? fmtNum(r.price_per_l,3)+' zł' : '—'}</td>
          <td class="mono" style="color:var(--accent)">${r.total ? fmtNum(r.total,2)+' zł' : '—'}</td>
          <td class="mono">${r.mileage ? fmtNum(r.mileage)+' km' : '—'}</td>
          <td>${consBadge(cons)}</td>
          <td style="font-size:12px;color:var(--text2)">${r.station || '—'}</td>
          <td style="white-space:nowrap">
            <button class="btn-edit" onclick="openRefuelModal(${r.id})">✏️</button>
            <button class="btn-danger" onclick="deleteRefuel(${r.id})">✕</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty">Błąd ładowania danych.</div></td></tr>';
    console.error(err);
  }
}

// ─── REPORTS ─────────────────────────────
async function loadReports() {
  try {
    const [dash, stats] = await Promise.all([
      api('GET', '/stats/dashboard'),
      api('GET', '/stats/vehicles'),
    ]);

    const avgPpL = dash.total_liters > 0 && dash.total_cost > 0 ? dash.total_cost / dash.total_liters : 0;

    $('report-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Łączny koszt</div><div class="stat-value">${fmtNum(dash.total_cost,0)}</div><div class="stat-unit">PLN</div></div>
      <div class="stat-card green"><div class="stat-label">Łącznie litrów</div><div class="stat-value">${fmtNum(dash.total_liters,0)}</div><div class="stat-unit">litrów</div></div>
      <div class="stat-card blue"><div class="stat-label">Śr. cena / litr</div><div class="stat-value">${fmtNum(avgPpL,2)}</div><div class="stat-unit">PLN/L</div></div>
      <div class="stat-card red"><div class="stat-label">Pojazdy</div><div class="stat-value">${fmtNum(dash.vehicle_count)}</div><div class="stat-unit">aktywne</div></div>
    `;

    const tbody = $('report-table');
    if (!stats.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty">Brak danych</div></td></tr>';
      return;
    }
    tbody.innerHTML = stats.map(v => `
      <tr>
        <td><div class="vehicle-name">${v.name}</div></td>
        <td class="mono">${v.plate}</td>
        <td class="mono">${v.refuel_count}</td>
        <td class="mono">${fmtNum(v.total_liters,1)} L</td>
        <td class="mono" style="color:var(--accent)">${fmtNum(v.total_cost,2)} zł</td>
        <td class="mono">${v.avg_price_per_l ? fmtNum(v.avg_price_per_l,3)+' zł' : '—'}</td>
        <td>${consBadge(v.avg_consumption)}</td>
        <td class="mono">${v.km_range ? fmtNum(v.km_range)+' km' : '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// ─── VEHICLE MODAL ───────────────────────
async function openVehicleModal(id = null) {
  $('vehicle-edit-id').value = '';
  $('modal-vehicle-title').textContent = 'Dodaj pojazd';
  ['v-name','v-plate','v-vin'].forEach(f => $(f).value = '');
  $('v-year').value = '';
  $('v-fuel').value = 'PB95';
  $('v-mileage').value = '';

  if (id) {
    try {
      const v = await api('GET', `/vehicles/${id}`);
      $('vehicle-edit-id').value = v.id;
      $('modal-vehicle-title').textContent = 'Edytuj pojazd';
      $('v-name').value = v.name;
      $('v-plate').value = v.plate;
      $('v-year').value = v.year || '';
      $('v-fuel').value = v.fuel_type || 'PB95';
      $('v-mileage').value = v.mileage || '';
      $('v-vin').value = v.vin || '';
    } catch (err) { showToast('❌ Błąd ładowania pojazdu'); return; }
  }
  $('modal-vehicle').classList.add('open');
}

async function saveVehicle() {
  const name = $('v-name').value.trim();
  const plate = $('v-plate').value.trim();
  if (!name || !plate) { showToast('⚠️ Wypełnij wymagane pola'); return; }
  const editId = $('vehicle-edit-id').value;
  const body = {
    name,
    plate: plate.toUpperCase(),
    year: $('v-year').value ? parseInt($('v-year').value) : null,
    fuel_type: $('v-fuel').value,
    mileage: $('v-mileage').value ? parseInt($('v-mileage').value) : 0,
    vin: $('v-vin').value.trim() || null,
  };
  try {
    if (editId) {
      await api('PUT', `/vehicles/${editId}`, body);
      showToast('✅ Pojazd zaktualizowany');
    } else {
      await api('POST', '/vehicles', body);
      showToast('✅ Pojazd dodany');
    }
    $('modal-vehicle').classList.remove('open');
    loadVehicles();
    updateFleetCount();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Błąd zapisu'));
  }
}

async function deleteVehicle(id) {
  if (!confirm('Usunąć pojazd i wszystkie jego tankowania?')) return;
  try {
    await api('DELETE', `/vehicles/${id}`);
    showToast('🗑️ Pojazd usunięty');
    loadVehicles();
    updateFleetCount();
  } catch (err) { showToast('❌ Błąd usuwania'); }
}

// ─── REFUEL MODAL ────────────────────────
async function openRefuelModal(id = null) {
  await populateVehicleSelect('r-vehicle', false);
  $('refuel-edit-id').value = '';
  $('modal-refuel-title').textContent = 'Dodaj tankowanie';
  $('r-date').value = new Date().toISOString().slice(0,10);
  $('r-vehicle').value = '';
  $('r-fuel').value = 'PB95';
  ['r-liters','r-price','r-total','r-mileage','r-station','r-notes'].forEach(f => $(f).value = '');

  if (id) {
    try {
      const r = await api('GET', `/refuels/${id}`);
      $('refuel-edit-id').value = r.id;
      $('modal-refuel-title').textContent = 'Edytuj tankowanie';
      $('r-vehicle').value = r.vehicle_id;
      $('r-date').value = r.date.slice(0,10);
      $('r-fuel').value = r.fuel_type || 'PB95';
      $('r-liters').value = r.liters;
      $('r-price').value = r.price_per_l || '';
      $('r-total').value = r.total || '';
      $('r-mileage').value = r.mileage || '';
      $('r-station').value = r.station || '';
      $('r-notes').value = r.notes || '';
    } catch (err) { showToast('❌ Błąd ładowania tankowania'); return; }
  }
  $('modal-refuel').classList.add('open');
}

async function saveRefuel() {
  const vehicle_id = parseInt($('r-vehicle').value);
  const date = $('r-date').value;
  const liters = parseFloat($('r-liters').value);
  if (!vehicle_id || !date || isNaN(liters) || liters <= 0) {
    showToast('⚠️ Wypełnij wymagane pola'); return;
  }
  const price_per_l = parseFloat($('r-price').value) || null;
  const total = parseFloat($('r-total').value) || null;
  const mileage = parseInt($('r-mileage').value) || null;
  const editId = $('refuel-edit-id').value;

  const body = {
    vehicle_id, date, liters,
    fuel_type: $('r-fuel').value,
    price_per_l, total, mileage,
    station: $('r-station').value.trim() || null,
    notes: $('r-notes').value.trim() || null,
  };

  try {
    if (editId) {
      await api('PUT', `/refuels/${editId}`, body);
      showToast('✅ Tankowanie zaktualizowane');
    } else {
      await api('POST', '/refuels', body);
      showToast('✅ Tankowanie zapisane');
    }
    $('modal-refuel').classList.remove('open');
    loadRefuels();
    loadDashboard();
    loadVehicleMonthlyChart();
    updateFleetCount();
  } catch (err) {
    showToast('❌ ' + (err.message || 'Błąd zapisu'));
  }
}

async function deleteRefuel(id) {
  if (!confirm('Usunąć to tankowanie?')) return;
  try {
    await api('DELETE', `/refuels/${id}`);
    showToast('🗑️ Tankowanie usunięte');
    loadRefuels();
    loadDashboard();
    loadVehicleMonthlyChart();
  } catch (err) { showToast('❌ Błąd usuwania'); }
}

// ─── POPULATE VEHICLE SELECT ─────────────
async function populateVehicleSelect(selectId, keepAll = false) {
  try {
    const vehicles = await api('GET', '/vehicles');
    const sel = $(selectId);
    const cur = sel.value;
    sel.innerHTML = keepAll
      ? '<option value="">Wszystkie pojazdy</option>'
      : '<option value="">— wybierz pojazd —</option>';
    vehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.plate})`;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  } catch {}
}

// ─── AUTO CALC TOTAL ─────────────────────
$('r-liters').addEventListener('input', calcTotal);
$('r-price').addEventListener('input', calcTotal);
$('r-total').addEventListener('input', calcPriceFromTotal);

function calcTotal() {
  const l = parseFloat($('r-liters').value);
  const p = parseFloat($('r-price').value);
  if (!isNaN(l) && !isNaN(p)) $('r-total').value = (l * p).toFixed(2);
}

function calcPriceFromTotal() {
  const l = parseFloat($('r-liters').value);
  const t = parseFloat($('r-total').value);
  if (!isNaN(l) && !isNaN(t) && l > 0) $('r-price').value = (t / l).toFixed(3);
}

// ─── EXPORT CSV ──────────────────────────
async function exportCSV() {
  try {
    const refuels = await api('GET', '/refuels');
    if (!refuels.length) { showToast('⚠️ Brak danych do eksportu'); return; }
    const headers = ['Data','Pojazd','Rejestracja','Paliwo','Litry','Cena/L','Koszt PLN','Przebieg','Stacja','Uwagi'];
    const rows = refuels.map(r => [
      r.date?.slice(0,10), r.vehicle_name, r.vehicle_plate, r.fuel_type,
      r.liters, r.price_per_l || '', r.total || '', r.mileage || '', r.station || '', r.notes || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tankowania_${new Date().toISOString().slice(0,10)}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('✅ Eksport gotowy');
  } catch (err) { showToast('❌ Błąd eksportu'); }
}

// ─── CLOSE MODALS ────────────────────────
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// ─── BUTTON BINDINGS ─────────────────────
$('btn-add-vehicle').addEventListener('click',  () => openVehicleModal());
$('btn-cancel-vehicle').addEventListener('click', () => $('modal-vehicle').classList.remove('open'));
$('btn-save-vehicle').addEventListener('click',  saveVehicle);

$('btn-add-refuel').addEventListener('click',   () => openRefuelModal());
$('btn-add-refuel2').addEventListener('click',  () => openRefuelModal());
$('btn-cancel-refuel').addEventListener('click', () => $('modal-refuel').classList.remove('open'));
$('btn-save-refuel').addEventListener('click',  saveRefuel);

$('btn-export').addEventListener('click', exportCSV);

$('filter-vehicle').addEventListener('change', loadRefuels);
$('filter-fuel').addEventListener('change', loadRefuels);
$('filter-month').addEventListener('change', loadRefuels);

// ─── LOGOUT ─────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});


// ─── INIT ────────────────────────────────
updateFleetCount();
loadDashboard();

// SKAN ZDJEC
let scannedData = null;
let scanFiles = [];

document.getElementById('btn-scan').addEventListener('click', openScanModal);
document.getElementById('btn-cancel-scan').addEventListener('click', () => {
  document.getElementById('modal-scan').classList.remove('open');
});

async function openScanModal() {
  scannedData = null;
  scanFiles = [];
  document.getElementById('scan-previews').innerHTML = '';
  document.getElementById('scan-result').classList.remove('show');
  document.getElementById('scan-tankpool').checked = false;
  document.getElementById('scan-analyzing').classList.remove('show');
  document.getElementById('scan-vehicle-row').style.display = 'none';
  document.getElementById('btn-analyze').disabled = true;
  document.getElementById('btn-analyze').style.display = '';
  document.getElementById('btn-scan-save').style.display = 'none';
  await populateVehicleSelect('scan-vehicle', false);
  document.getElementById('modal-scan').classList.add('open');
}

const scanDrop = document.getElementById('scan-drop');
scanDrop.addEventListener('click', () => document.getElementById('scan-input').click());
scanDrop.addEventListener('dragover', e => { e.preventDefault(); scanDrop.classList.add('dragover'); });
scanDrop.addEventListener('dragleave', () => scanDrop.classList.remove('dragover'));
scanDrop.addEventListener('drop', e => {
  e.preventDefault();
  scanDrop.classList.remove('dragover');
  handleScanFiles(Array.from(e.dataTransfer.files));
});
document.getElementById('scan-input').addEventListener('change', e => {
  handleScanFiles(Array.from(e.target.files));
});

function handleScanFiles(files) {
  scanFiles = files.filter(f => f.type.startsWith('image/')).slice(0, 5);
  const prev = document.getElementById('scan-previews');
  prev.innerHTML = '';
  scanFiles.forEach(f => {
    const img = document.createElement('img');
    img.className = 'scan-preview';
    img.src = URL.createObjectURL(f);
    prev.appendChild(img);
  });
  document.getElementById('btn-analyze').disabled = scanFiles.length === 0;
}

document.getElementById('btn-analyze').addEventListener('click', async () => {
  if (!scanFiles.length) return;
  document.getElementById('scan-analyzing').classList.add('show');
  document.getElementById('scan-result').classList.remove('show');
  document.getElementById('btn-analyze').disabled = true;

  try {
    const country = document.getElementById('scan-country').value;
    const fd = new FormData();
    scanFiles.forEach(f => fd.append('images', f));
    fd.append('country', country);
    const useTankpool = document.getElementById('scan-tankpool').checked;
    fd.append('use_tankpool', useTankpool ? 'true' : 'false');
    const res = await fetch('/api/scan', { method: 'POST', body: fd });
    const json = await res.json();
    scannedData = json.data || {};
    const meta = json.meta || {};

    // Wpisz wartości do edytowalnych pól
    document.getElementById('sr-mileage').value = scannedData.mileage || '';
    document.getElementById('sr-liters').value  = scannedData.liters  || '';
    document.getElementById('sr-price').value   = scannedData.price_per_l || '';
    document.getElementById('sr-total').value   = scannedData.total   || '';
    document.getElementById('sr-fuel').value    = scannedData.fuel_type || 'ON';
    document.getElementById('sr-station').value = scannedData.station || '';

    // Pokaz info o kursie (defensywnie)
    const rateInfo = document.getElementById('sr-rate-info');
    if (rateInfo) {
      const rateLines = [];
      if (meta.currency && meta.currency !== 'PLN' && meta.rate) {
        rateLines.push('1 ' + meta.currency + ' = ' + meta.rate.toFixed(4) + ' PLN (NBP ' + (meta.rate_date || '') + ')');
      }
      if (meta.price_auto_fetched && meta.price_source) {
        rateLines.push('Cena: ' + meta.price_source);
      }
      rateInfo.innerHTML = rateLines.join('<br>');
      rateInfo.style.display = rateLines.length ? '' : 'none';
    }

    document.getElementById('scan-result').classList.add('show');
    document.getElementById('scan-vehicle-row').style.display = '';
    document.getElementById('btn-scan-save').style.display = '';
    document.getElementById('btn-analyze').style.display = 'none';
  } catch (err) {
    showToast('Blad analizy zdjęć');
    document.getElementById('btn-analyze').disabled = false;
  } finally {
    document.getElementById('scan-analyzing').classList.remove('show');
  }
});

document.getElementById('btn-scan-save').addEventListener('click', async () => {
  const vehicleId = parseInt(document.getElementById('scan-vehicle').value);
  if (!vehicleId) { showToast('Wybierz pojazd!'); return; }
  if (!scannedData || !scannedData.liters) { showToast('Brak danych do zapisania'); return; }

  try {
    // Czytaj z edytowalnych pol (uzytkownik mogl poprawic)
    const liters = parseFloat(document.getElementById('sr-liters').value);
    if (!liters || liters <= 0) { showToast('Podaj prawidlowa ilosc litrow!'); return; }
    const refuelBody = {
      vehicle_id: vehicleId,
      date: new Date().toISOString().slice(0,10),
      liters: liters,
      fuel_type: document.getElementById('sr-fuel').value || 'ON',
    };
    const price = parseFloat(document.getElementById('sr-price').value);
    const total = parseFloat(document.getElementById('sr-total').value);
    const mileage = parseInt(document.getElementById('sr-mileage').value);
    const station = document.getElementById('sr-station').value.trim();
    if (price > 0) refuelBody.price_per_l = price;
    if (total > 0) refuelBody.total = total;
    if (mileage > 0) refuelBody.mileage = mileage;
    if (station) refuelBody.station = station;
    refuelBody.notes = 'Dodano przez skan zdjęć';
    await api('POST', '/refuels', refuelBody);
    showToast('Tankowanie zapisane!');
    document.getElementById('modal-scan').classList.remove('open');
    loadDashboard();
    loadVehicleMonthlyChart();
    loadRefuels();
  } catch (err) {
    showToast('Blad zapisu: ' + err.message);
  }
});

// KOLORY DLA AUT
const VEHICLE_COLORS = ['#00d4c8','#3498db','#9b59b6','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e67e22'];

// WYKRES PER POJAZD PER MIESIAC
async function loadVehicleMonthlyChart() {
  try {
    const data = await api('GET', '/stats/monthly-vehicles');
    if (!data) return;

    const { vehicles, months, current_data, current_month } = data;

    // Label biezacego miesiaca
    const mlabel = document.getElementById('current-month-label');
    if (mlabel && current_month) {
      const parts = current_month.split('-');
      const names = ['','Styczen','Luty','Marzec','Kwiecien','Maj','Czerwiec','Lipiec','Sierpien','Wrzesien','Pazdziernik','Listopad','Grudzien'];
      mlabel.textContent = names[parseInt(parts[1])] + ' ' + parts[0];
    }

    // BIEZACY MIESIAC
    const el = document.getElementById('vehicle-monthly-chart');
    if (el) {
      const withData = (current_data || []).filter(function(v) { return v.total_liters > 0; });
      if (!withData.length) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">⛽</div><div>Brak tankowan w tym miesiacu</div></div>';
      } else {
        const maxL = Math.max.apply(null, withData.map(function(v) { return v.total_liters; }));
        el.innerHTML = withData.map(function(v, i) {
          const pct = maxL > 0 ? (v.total_liters / maxL * 100).toFixed(1) : 0;
          const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
          const shortName = v.vehicle_name ? v.vehicle_name.split(' ').slice(-2).join(' ') : v.plate;
          const costStr = v.total_cost > 0 ? ' <span style="color:var(--text3);font-size:10px;margin-left:6px">' + v.total_cost.toFixed(0) + ' zl</span>' : '';
          return '<div style="margin-bottom:14px">'
            + '<div style="display:flex;justify-content:space-between;margin-bottom:5px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--text)">' + shortName
            + ' <span style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-left:6px">' + v.plate + '</span></div>'
            + '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + color + '">'
            + v.total_liters.toFixed(1) + ' L' + costStr + '</div>'
            + '</div>'
            + '<div style="height:10px;background:var(--bg3);border-radius:5px;overflow:hidden">'
            + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:5px"></div>'
            + '</div></div>';
        }).join('');
      }
    }

    // HISTORIA 6 MIESIECY
    const histEl = document.getElementById('vehicle-history-chart');
    if (!histEl || !months || !months.length || !vehicles || !vehicles.length) {
      if (histEl) histEl.innerHTML = '<div class="empty"><div>Brak danych historycznych</div></div>';
      return;
    }

    // Macierz danych
    const matrix = {};
    vehicles.forEach(function(v) {
      matrix[v.id] = {};
      months.forEach(function(m) { matrix[v.id][m] = 0; });
    });
    (data.data || []).forEach(function(row) {
      if (row.month && matrix[row.vehicle_id] !== undefined) {
        matrix[row.vehicle_id][row.month] = row.total_liters || 0;
      }
    });

    const activeVehicles = vehicles.filter(function(v) {
      return months.some(function(m) { return matrix[v.id][m] > 0; });
    });

    if (!activeVehicles.length) {
      histEl.innerHTML = '<div class="empty"><div>Brak danych historycznych</div></div>';
      return;
    }

    const allVals = activeVehicles.reduce(function(acc, v) {
      return acc.concat(months.map(function(m) { return matrix[v.id][m]; }));
    }, []);
    const maxVal = Math.max.apply(null, allVals) || 1;

    // Legenda
    const legend = activeVehicles.map(function(v, i) {
      const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
      const shortName = v.name ? v.name.split(' ').slice(-2).join(' ') : v.plate;
      return '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)">'
        + '<div style="width:10px;height:10px;border-radius:2px;background:' + color + ';flex-shrink:0"></div>'
        + shortName + '</div>';
    }).join('');

    // Slupki
    const bars = months.map(function(month) {
      const [y, mo] = month.split('-');
      const label = mo + '/' + y.slice(2);
      const groupBars = activeVehicles.map(function(v, vi) {
        const val = matrix[v.id][month] || 0;
        const h = maxVal > 0 ? Math.max(2, (val / maxVal * 100)).toFixed(1) : 2;
        const color = VEHICLE_COLORS[vi % VEHICLE_COLORS.length];
        const title = v.name + ': ' + val.toFixed(1) + 'L';
        return '<div title="' + title + '" style="width:20px;height:' + h + '%;background:' + color + ';border-radius:2px 2px 0 0;opacity:0.85"></div>';
      }).join('');
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">'
        + '<div style="display:flex;align-items:flex-end;gap:2px;height:100px">' + groupBars + '</div>'
        + '<div style="font-family:var(--mono);font-size:9px;color:var(--text3)">' + label + '</div>'
        + '</div>';
    }).join('');

    histEl.innerHTML = '<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap">' + legend + '</div>'
      + '<div style="display:flex;align-items:flex-end;gap:4px;height:120px;padding-bottom:20px">' + bars + '</div>';

  } catch(err) {
    console.error('Wykres per pojazd:', err);
  }
}
