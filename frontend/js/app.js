/* ─── FleetFuel / Vipremium Fuel — app.js ─── */
const API = '/api';
const $ = id => document.getElementById(id);
const fmtNum = (n, dec=0) => n==null||isNaN(n) ? '—' : Number(n).toLocaleString('pl-PL',{minimumFractionDigits:dec,maximumFractionDigits:dec});
const fmtDate = d => { if(!d) return '—'; const [y,m,day]=d.slice(0,10).split('-'); return `${day}.${m}.${y}`; };

function showToast(msg, dur=2500) {
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur);
}

async function api(method, path, body) {
  const opts={method,headers:{'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  const res=await fetch(API+path,opts);
  if(res.status===401){window.location.href='/login.html';return;}
  if(res.status===204) return null;
  const json=await res.json();
  if(!res.ok) throw new Error(json.error||JSON.stringify(json.errors));
  return json;
}

function fuelBadge(type) {
  const colors={PB95:'#3498db',PB98:'#9b59b6',ON:'#00d4c8',LPG:'#2ecc71',EV:'#1abc9c'};
  return `<span class="badge badge-fuel"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${colors[type]||'#666'};margin-right:4px"></span>${type}</span>`;
}

function consBadge(val) {
  if(val==null) return '—';
  const v=parseFloat(val);
  const cls=v>12?'badge-warn':v<7?'badge-ok':'badge-fuel';
  return `<span class="badge ${cls}">${fmtNum(v,1)} L/100</span>`;
}

/* ─── NAVIGATION ─── */
function showSection(name) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  const sec=$('section-'+name);
  if(sec) sec.classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.section===name) b.classList.add('active');});
  if(name==='dashboard')  loadDashboard();
  if(name==='vehicles')   loadVehicles();
  if(name==='refuels')    loadRefuels();
  if(name==='reports')    loadReports();
  if(name==='invoices')   loadInvoices();
  if(name==='comparison') loadComparison();
}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.section)));

/* ─── FLEET COUNT ─── */
async function updateFleetCount() {
  try {
    const d=await api('GET','/stats/dashboard');
    const n=d.vehicle_count;
    $('fleet-count').textContent=`${n} POJAZD${n===1?'':n<5?'Y':'ÓW'}`;
  } catch(e){}
}

/* ─── DASHBOARD ─── */
async function loadDashboard() {
  try {
    const [dash,monthly,perVehicle,refuels]=await Promise.all([
      api('GET','/stats/dashboard'),
      api('GET','/stats/monthly'),
      api('GET','/stats/vehicles'),
      api('GET','/refuels'),
    ]);
    $('dash-vehicles').textContent=fmtNum(dash.vehicle_count);
    $('dash-refuels').textContent=fmtNum(dash.refuel_count);
    $('dash-liters').textContent=fmtNum(dash.total_liters,2);
    $('dash-cost').textContent=fmtNum(dash.total_cost,2);

    const chartEl=$('monthly-chart');
    if(!monthly.length){chartEl.innerHTML='<div class="empty"><div>Brak danych</div></div>';}
    else {
      const max=Math.max(...monthly.map(m=>m.total_cost));
      chartEl.innerHTML=monthly.map(m=>{
        const h=max>0?Math.max(4,(m.total_cost/max*100)).toFixed(1):4;
        const label=m.month.slice(5)+'/'+m.month.slice(2,4);
        return `<div class="bar-wrap"><div class="bar-val">${fmtNum(m.total_cost,0)}</div><div class="bar" style="height:${h}%" title="${fmtNum(m.total_cost,2)} PLN"></div><div class="bar-label">${label}</div></div>`;
      }).join('');
    }

    const consEl=$('consumption-chart');
    const withCons=perVehicle.filter(v=>v.avg_consumption!=null);
    if(!withCons.length){consEl.innerHTML='<div class="empty"><div>Brak danych</div></div>';}
    else {
      const maxC=Math.max(...withCons.map(v=>parseFloat(v.avg_consumption)));
      consEl.innerHTML=withCons.map(v=>`
        <div class="cons-row">
          <div class="cons-name" title="${v.name}">${v.plate||v.name}</div>
          <div class="cons-bar-bg"><div class="cons-bar-fill" style="width:${(parseFloat(v.avg_consumption)/maxC*100).toFixed(1)}%"></div></div>
          <div class="cons-val">${fmtNum(v.avg_consumption,1)} L</div>
        </div>`).join('');
    }

    const tbody=$('dash-refuels-table');
    const recent=refuels.slice(0,8);
    if(!recent.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty"><div>Brak tankowań</div></div></td></tr>';}
    else tbody.innerHTML=recent.map(r=>`
      <tr>
        <td class="mono">${fmtDate(r.date)}</td>
        <td><div class="vehicle-name">${r.vehicle_plate}</div><div class="vehicle-plate">${r.vehicle_name}</div></td>
        <td>${fuelBadge(r.fuel_type)}</td>
        <td class="mono">${fmtNum(r.liters,2)} L</td>
        <td class="mono">${r.price_per_l?fmtNum(r.price_per_l,3)+' zł':'—'}</td>
        <td class="mono">${r.total?fmtNum(r.total,2)+' zł':'—'}</td>
        <td class="mono">${r.mileage?fmtNum(r.mileage)+' km':'—'}</td>
      </tr>`).join('');

    loadVehicleMonthlyChart();
  } catch(err){console.error('Dashboard:',err);}
}

/* ─── VEHICLES ─── */
async function loadVehicles() {
  const grid=$('vehicles-grid');
  grid.innerHTML='<div class="loading">Ładowanie...</div>';
  try {
    const vehicles=await api('GET','/vehicles');
    if(!vehicles.length){grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🚗</div><div>Brak pojazdów</div></div>';return;}
    grid.innerHTML=vehicles.map(v=>{
      const vr_count=v.refuel_count||0;
      const totalL=v.total_liters||0;
      const totalC=v.total_cost||0;
      return `<div class="vehicle-card">
        <div class="vc-header">
          <div><div class="vc-name">${v.plate}</div><div style="color:var(--text3);font-size:11px;margin-top:2px">${v.name} ${v.year?'· '+v.year:''} ${fuelBadge(v.fuel_type)}</div></div>
          <div class="vc-plate">${v.plate}</div>
        </div>
        <div class="vc-stats">
          <div><div class="vc-stat-label">Tankowania</div><div class="vc-stat-val">${vr_count}</div></div>
          <div><div class="vc-stat-label">Litry</div><div class="vc-stat-val">${fmtNum(totalL,0)}</div></div>
          <div><div class="vc-stat-label">Koszt PLN</div><div class="vc-stat-val">${fmtNum(totalC,0)}</div></div>
          <div><div class="vc-stat-label">Przebieg</div><div class="vc-stat-val">${v.last_mileage?fmtNum(v.last_mileage):(v.mileage?fmtNum(v.mileage):'—')}</div></div>
          <div><div class="vc-stat-label">VIN</div><div class="vc-stat-val" style="font-size:10px;color:var(--text3)">${v.vin||'—'}</div></div>
          <div><div class="vc-stat-label">Rok</div><div class="vc-stat-val">${v.year||'—'}</div></div>
        </div>
        <div class="vc-actions">
          <button class="btn-ghost" style="flex:1;text-align:center;font-size:11px" onclick="gotoVehicleRefuels(${v.id})">Historia tankowań</button>
          <button class="btn-edit" onclick="openVehicleModal(${v.id})">✏️</button>
          <button class="btn-danger" onclick="deleteVehicle(${v.id})">✕</button>
        </div>
      </div>`;
    }).join('');
  } catch(err){grid.innerHTML='<div class="empty">Błąd ładowania</div>';}
}

function gotoVehicleRefuels(vehicleId) {
  showSection('refuels');
  setTimeout(()=>{$('filter-vehicle').value=vehicleId;loadRefuels();},50);
}

/* ─── REFUELS ─── */
async function loadRefuels() {
  await populateVehicleSelect('filter-vehicle',true);
  await populateVehicleSelect('r-vehicle',false);
  const params=new URLSearchParams();
  const fv=$('filter-vehicle').value, ff=$('filter-fuel').value, fm=$('filter-month').value;
  if(fv) params.set('vehicle_id',fv);
  if(ff) params.set('fuel_type',ff);
  if(fm) params.set('month',fm);
  const tbody=$('refuels-table');
  tbody.innerHTML='<tr><td colspan="10"><div class="loading">Ładowanie...</div></td></tr>';
  try {
    const refuels=await api('GET',`/refuels?${params}`);
    if(!refuels.length){tbody.innerHTML='<tr><td colspan="10"><div class="empty"><div class="empty-icon">⛽</div><div>Brak wyników</div></div></td></tr>';return;}
    const byVehicle={};
    refuels.forEach(r=>{(byVehicle[r.vehicle_id]=byVehicle[r.vehicle_id]||[]).push(r);});
    tbody.innerHTML=refuels.map(r=>{
      const vArr=(byVehicle[r.vehicle_id]||[]).filter(x=>x.mileage).sort((a,b)=>a.mileage-b.mileage);
      let cons=null;
      if(r.mileage){const idx=vArr.findIndex(x=>x.id===r.id);if(idx>0){const dist=r.mileage-vArr[idx-1].mileage;if(dist>0) cons=parseFloat(r.liters)/dist*100;}}
      return `<tr>
        <td class="mono">${fmtDate(r.date)}</td>
        <td><div class="vehicle-name" style="font-size:13px;font-weight:700">${r.vehicle_plate}</div><div class="vehicle-plate" style="font-size:11px;color:var(--text3)">${r.vehicle_name}</div></td>
        <td>${fuelBadge(r.fuel_type)}</td>
        <td class="mono">${fmtNum(r.liters,2)} L</td>
        <td class="mono">${r.price_per_l?fmtNum(r.price_per_l,3)+' zł':'—'}</td>
        <td class="mono" style="color:var(--accent)">${r.total?fmtNum(r.total,2)+' zł':'—'}</td>
        <td class="mono">${r.mileage?fmtNum(r.mileage)+' km':'—'}</td>
        <td>${consBadge(cons)}</td>
        <td style="font-size:12px;color:var(--text2)">${r.station||'—'}</td>
        <td style="white-space:nowrap">
          <button class="btn-edit" onclick="openRefuelModal(${r.id})">✏️</button>
          <button class="btn-danger" onclick="deleteRefuel(${r.id})">✕</button>
        </td>
      </tr>`;
    }).join('');
  } catch(err){tbody.innerHTML='<tr><td colspan="10"><div class="empty">Błąd</div></td></tr>';}
}

/* ─── REPORTS ─── */
async function loadReports() {
  try {
    const [dash,stats]=await Promise.all([api('GET','/stats/dashboard'),api('GET','/stats/vehicles')]);
    const avgPpL=dash.total_liters>0&&dash.total_cost>0?dash.total_cost/dash.total_liters:0;
    $('report-stats').innerHTML=`
      <div class="stat-card"><div class="stat-label">Łączny koszt</div><div class="stat-value">${fmtNum(dash.total_cost,0)}</div><div class="stat-unit">PLN</div></div>
      <div class="stat-card green"><div class="stat-label">Łącznie litrów</div><div class="stat-value">${fmtNum(dash.total_liters,0)}</div><div class="stat-unit">litrów</div></div>
      <div class="stat-card blue"><div class="stat-label">Śr. cena / litr</div><div class="stat-value">${fmtNum(avgPpL,2)}</div><div class="stat-unit">PLN/L</div></div>
      <div class="stat-card red"><div class="stat-label">Pojazdy</div><div class="stat-value">${fmtNum(dash.vehicle_count)}</div><div class="stat-unit">aktywne</div></div>`;
    const tbody=$('report-table');
    if(!stats.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty">Brak danych</div></td></tr>';return;}
    tbody.innerHTML=stats.map(v=>`
      <tr>
        <td><div class="vehicle-name">${v.plate}</div><div style="font-size:11px;color:var(--text3)">${v.name}</div></td>
        <td class="mono">${v.plate}</td>
        <td class="mono">${v.refuel_count}</td>
        <td class="mono">${fmtNum(v.total_liters,1)} L</td>
        <td class="mono" style="color:var(--accent)">${fmtNum(v.total_cost,2)} zł</td>
        <td class="mono">${v.avg_price_per_l?fmtNum(v.avg_price_per_l,3)+' zł':'—'}</td>
        <td>${consBadge(v.avg_consumption)}</td>
        <td class="mono">${v.km_range?fmtNum(v.km_range)+' km':'—'}</td>
      </tr>`).join('');
  } catch(err){console.error('Reports:',err);}
}

/* ─── VEHICLE MODAL ─── */
async function openVehicleModal(id=null) {
  $('vehicle-edit-id').value='';
  $('modal-vehicle-title').textContent='Dodaj pojazd';
  ['v-name','v-plate','v-vin'].forEach(f=>$(f).value='');
  $('v-year').value=''; $('v-fuel').value='PB95'; $('v-mileage').value='';
  if(id){
    try{const v=await api('GET',`/vehicles/${id}`);$('vehicle-edit-id').value=v.id;$('modal-vehicle-title').textContent='Edytuj pojazd';$('v-name').value=v.name;$('v-plate').value=v.plate;$('v-year').value=v.year||'';$('v-fuel').value=v.fuel_type||'PB95';$('v-mileage').value=v.mileage||'';$('v-vin').value=v.vin||'';}catch(e){showToast('Błąd ładowania');return;}
  }
  $('modal-vehicle').classList.add('open');
}

async function saveVehicle() {
  const name=$('v-name').value.trim(), plate=$('v-plate').value.trim();
  if(!name||!plate){showToast('⚠️ Wypełnij wymagane pola');return;}
  const editId=$('vehicle-edit-id').value;
  const body={name,plate:plate.toUpperCase(),year:$('v-year').value?parseInt($('v-year').value):null,fuel_type:$('v-fuel').value,mileage:$('v-mileage').value?parseInt($('v-mileage').value):0,vin:$('v-vin').value.trim()||null};
  try{
    if(editId){await api('PUT',`/vehicles/${editId}`,body);showToast('✅ Pojazd zaktualizowany');}
    else{await api('POST','/vehicles',body);showToast('✅ Pojazd dodany');}
    $('modal-vehicle').classList.remove('open');
    loadVehicles(); updateFleetCount();
  }catch(err){showToast('❌ '+err.message);}
}

async function deleteVehicle(id) {
  if(!confirm('Usunąć pojazd i wszystkie jego tankowania?')) return;
  try{await api('DELETE',`/vehicles/${id}`);showToast('🗑️ Pojazd usunięty');loadVehicles();updateFleetCount();}
  catch(e){showToast('❌ Błąd usuwania');}
}

/* ─── REFUEL MODAL ─── */
async function openRefuelModal(id=null) {
  await populateVehicleSelect('r-vehicle',false);
  $('refuel-edit-id').value='';
  $('modal-refuel-title').textContent='Dodaj tankowanie';
  $('r-date').value=new Date().toISOString().slice(0,10);
  $('r-vehicle').value=''; $('r-fuel').value='ON';
  ['r-liters','r-price','r-total','r-mileage','r-station','r-notes'].forEach(f=>$(f).value='');
  if(id){
    try{const r=await api('GET',`/refuels/${id}`);$('refuel-edit-id').value=r.id;$('modal-refuel-title').textContent='Edytuj tankowanie';$('r-vehicle').value=r.vehicle_id;$('r-date').value=r.date.slice(0,10);$('r-fuel').value=r.fuel_type||'ON';$('r-liters').value=r.liters;$('r-price').value=r.price_per_l||'';$('r-total').value=r.total||'';$('r-mileage').value=r.mileage||'';$('r-station').value=r.station||'';$('r-notes').value=r.notes||'';}catch(e){showToast('❌ Błąd');return;}
  }
  $('modal-refuel').classList.add('open');
}

async function saveRefuel() {
  const vehicle_id=parseInt($('r-vehicle').value), date=$('r-date').value, liters=parseFloat($('r-liters').value);
  if(!vehicle_id||!date||isNaN(liters)||liters<=0){showToast('⚠️ Wypełnij wymagane pola');return;}
  const price_per_l=parseFloat($('r-price').value)||null, total=parseFloat($('r-total').value)||null, mileage=parseInt($('r-mileage').value)||null, editId=$('refuel-edit-id').value;
  const body={vehicle_id,date,liters,fuel_type:$('r-fuel').value,price_per_l,total,mileage,station:$('r-station').value.trim()||null,notes:$('r-notes').value.trim()||null};
  try{
    if(editId){await api('PUT',`/refuels/${editId}`,body);showToast('✅ Tankowanie zaktualizowane');}
    else{await api('POST','/refuels',body);showToast('✅ Tankowanie zapisane');}
    $('modal-refuel').classList.remove('open');
    loadRefuels(); loadDashboard(); updateFleetCount();
  }catch(err){showToast('❌ '+err.message);}
}

async function deleteRefuel(id) {
  if(!confirm('Usunąć to tankowanie?')) return;
  try{await api('DELETE',`/refuels/${id}`);showToast('🗑️ Tankowanie usunięte');loadRefuels();loadDashboard();}
  catch(e){showToast('❌ Błąd');}
}

async function populateVehicleSelect(selectId, keepAll=false) {
  try{
    const vehicles=await api('GET','/vehicles');
    const sel=$(selectId); const cur=sel.value;
    sel.innerHTML=keepAll?'<option value="">Wszystkie pojazdy</option>':'<option value="">— wybierz pojazd —</option>';
    vehicles.forEach(v=>{const opt=document.createElement('option');opt.value=v.id;opt.textContent=`${v.plate} — ${v.name}`;sel.appendChild(opt);});
    if(cur) sel.value=cur;
  }catch(e){}
}

$('r-liters').addEventListener('input',()=>{const l=parseFloat($('r-liters').value),p=parseFloat($('r-price').value);if(!isNaN(l)&&!isNaN(p))$('r-total').value=(l*p).toFixed(2);});
$('r-price').addEventListener('input',()=>{const l=parseFloat($('r-liters').value),p=parseFloat($('r-price').value);if(!isNaN(l)&&!isNaN(p))$('r-total').value=(l*p).toFixed(2);});
$('r-total').addEventListener('input',()=>{const l=parseFloat($('r-liters').value),t=parseFloat($('r-total').value);if(!isNaN(l)&&!isNaN(t)&&l>0)$('r-price').value=(t/l).toFixed(3);});

/* ─── EXPORT CSV ─── */
async function exportCSV() {
  try{
    const refuels=await api('GET','/refuels');
    if(!refuels.length){showToast('⚠️ Brak danych');return;}
    const headers=['Data','Rejestracja','Pojazd','Paliwo','Litry','Cena/L','Koszt PLN','Przebieg','Stacja','Uwagi'];
    const rows=refuels.map(r=>[r.date?.slice(0,10),r.vehicle_plate,r.vehicle_name,r.fuel_type,r.liters,r.price_per_l||'',r.total||'',r.mileage||'',r.station||'',r.notes||'']);
    const csv=[headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'})),download:`tankowania_${new Date().toISOString().slice(0,10)}.csv`});
    a.click(); showToast('✅ Eksport gotowy');
  }catch(e){showToast('❌ Błąd eksportu');}
}

/* ─── SCAN MODAL ─── */
let scanFiles=[], scannedData=null;

async function openScanModal() {
  scannedData=null; scanFiles=[];
  $('scan-previews').innerHTML='';
  $('scan-result').classList.remove('show');
  $('scan-analyzing').classList.remove('show');
  $('scan-vehicle-row').style.display='none';
  $('btn-analyze').disabled=true;
  $('btn-analyze').style.display='';
  $('btn-scan-save').style.display='none';
  await populateVehicleSelect('scan-vehicle',false);
  $('modal-scan').classList.add('open');
}

const scanDrop=$('scan-drop');
scanDrop.addEventListener('click',()=>$('scan-input').click());
scanDrop.addEventListener('dragover',e=>{e.preventDefault();scanDrop.classList.add('dragover');});
scanDrop.addEventListener('dragleave',()=>scanDrop.classList.remove('dragover'));
scanDrop.addEventListener('drop',e=>{e.preventDefault();scanDrop.classList.remove('dragover');handleScanFiles(Array.from(e.dataTransfer.files));});
$('scan-input').addEventListener('change',e=>handleScanFiles(Array.from(e.target.files)));

function handleScanFiles(files) {
  scanFiles=files.filter(f=>f.type.startsWith('image/')).slice(0,5);
  const prev=$('scan-previews'); prev.innerHTML='';
  scanFiles.forEach(f=>{const img=document.createElement('img');img.className='scan-preview';img.src=URL.createObjectURL(f);prev.appendChild(img);});
  $('btn-analyze').disabled=scanFiles.length===0;
}

$('btn-analyze').addEventListener('click',async()=>{
  if(!scanFiles.length) return;
  $('scan-analyzing').classList.add('show');
  $('scan-result').classList.remove('show');
  $('btn-analyze').disabled=true;
  try{
    const country=$('scan-country').value;
    const useTankpool=$('scan-tankpool').checked;
    const fd=new FormData();
    scanFiles.forEach(f=>fd.append('images',f));
    fd.append('country',country);
    fd.append('use_tankpool',useTankpool?'true':'false');
    const res=await fetch('/api/scan',{method:'POST',body:fd});
    const json=await res.json();
    scannedData=json.data||{};
    const meta=json.meta||{};
    $('sr-mileage').value=scannedData.mileage||'';
    $('sr-liters').value=scannedData.liters||'';
    $('sr-price').value=scannedData.price_per_l||'';
    const autoTotal = scannedData.total ||
      (scannedData.price_per_l && scannedData.liters
        ? Math.round(scannedData.price_per_l * scannedData.liters * 100) / 100
        : null);
    $('sr-total').value=autoTotal||'';
    $('sr-fuel').value=scannedData.fuel_type||'ON';
    $('sr-station').value=scannedData.station||'';
    const ri=$('sr-rate-info');
    if(ri){
      const lines=[];
      if(meta.currency&&meta.currency!=='PLN'&&meta.rate) lines.push(`1 ${meta.currency} = ${meta.rate.toFixed(4)} PLN (NBP ${meta.rate_date||''})`);
      if(meta.price_auto_fetched&&meta.price_source) lines.push('Cena: '+meta.price_source);
      ri.innerHTML=lines.join('<br>'); ri.style.display=lines.length?'':'none';
    }
    $('scan-result').classList.add('show');
    $('scan-vehicle-row').style.display='';
    $('btn-scan-save').style.display='';
    $('btn-analyze').style.display='none';
  }catch(e){showToast('❌ Błąd analizy: '+e.message);$('btn-analyze').disabled=false;}
  finally{$('scan-analyzing').classList.remove('show');}
});

$('btn-scan-save').addEventListener('click',async()=>{
  const vehicleId=parseInt($('scan-vehicle').value);
  if(!vehicleId){showToast('Wybierz pojazd!');return;}
  const liters=parseFloat($('sr-liters').value);
  if(!liters||liters<=0){showToast('Podaj prawidłową ilość litrów!');return;}
  const body={vehicle_id:vehicleId,date:new Date().toISOString().slice(0,10),liters,fuel_type:$('sr-fuel').value||'ON'};
  const price=parseFloat($('sr-price').value), total=parseFloat($('sr-total').value), mileage=parseInt($('sr-mileage').value), station=$('sr-station').value.trim();
  if(price>0) body.price_per_l=price;
  if(total>0) body.total=total;
  if(mileage>0) body.mileage=mileage;
  if(station) body.station=station;
  body.notes='Dodano przez skan zdjęć';
  try{await api('POST','/refuels',body);showToast('✅ Tankowanie zapisane');$('modal-scan').classList.remove('open');loadDashboard();loadRefuels();}
  catch(e){showToast('❌ '+e.message);}
});

/* ─── VEHICLE MONTHLY CHART ─── */
const VEHICLE_COLORS=['#00d4c8','#3498db','#9b59b6','#2ecc71','#e74c3c','#f39c12','#1abc9c','#e67e22'];

async function loadVehicleMonthlyChart() {
  try{
    const data=await api('GET','/stats/monthly-vehicles');
    if(!data) return;
    const {vehicles,months,current_data,current_month}=data;
    const mlabel=$('current-month-label');
    if(mlabel&&current_month){const p=current_month.split('-');const names=['','Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];mlabel.textContent=names[parseInt(p[1])]+' '+p[0];}
    const el=$('vehicle-monthly-chart');
    if(el){
      const withData=(current_data||[]).filter(v=>v.total_liters>0);
      if(!withData.length){el.innerHTML='<div class="empty"><div class="empty-icon">⛽</div><div>Brak tankowań w tym miesiącu</div></div>';}
      else{
        const maxL=Math.max(...withData.map(v=>v.total_liters));
        el.innerHTML=withData.map((v,i)=>{
          const pct=maxL>0?(v.total_liters/maxL*100).toFixed(1):0;
          const color=VEHICLE_COLORS[i%VEHICLE_COLORS.length];
          const sn=v.plate||v.vehicle_name||'?';
          const cost=v.total_cost>0?` <span style="color:var(--text3);font-size:10px">${v.total_cost.toFixed(0)} zł</span>`:'';
          return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;margin-bottom:5px"><div style="font-size:13px;font-weight:700;color:var(--text)">${sn}</div><div style="font-family:var(--mono);font-size:13px;font-weight:700;color:${color}">${v.total_liters.toFixed(1)} L${cost}</div></div><div style="height:10px;background:var(--bg3);border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color};border-radius:5px"></div></div></div>`;
        }).join('');
      }
    }
    const histEl=$('vehicle-history-chart');
    if(!histEl||!months||!months.length||!vehicles||!vehicles.length){if(histEl) histEl.innerHTML='<div class="empty"><div>Brak danych historycznych</div></div>';return;}
    const matrix={};
    vehicles.forEach(v=>{matrix[v.id]={};months.forEach(m=>{matrix[v.id][m]=0;});});
    (data.data||[]).forEach(row=>{if(row.month&&matrix[row.vehicle_id]!==undefined) matrix[row.vehicle_id][row.month]=row.total_liters||0;});
    const activeVehicles=vehicles.filter(v=>months.some(m=>matrix[v.id][m]>0));
    if(!activeVehicles.length){histEl.innerHTML='<div class="empty"><div>Brak danych historycznych</div></div>';return;}
    const allVals=activeVehicles.reduce((acc,v)=>acc.concat(months.map(m=>matrix[v.id][m])),[]);
    const maxVal=Math.max(...allVals)||1;
    const legend=activeVehicles.map((v,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)"><div style="width:10px;height:10px;border-radius:2px;background:${VEHICLE_COLORS[i%VEHICLE_COLORS.length]};flex-shrink:0"></div>${v.plate||v.name||'?'}</div>`).join('');
    const bars=months.map(month=>{
      const [y,mo]=month.split('-');
      const label=mo+'/'+y.slice(2);
      const groupBars=activeVehicles.map((v,vi)=>{
        const val=matrix[v.id][month]||0;
        const h=maxVal>0?Math.max(2,(val/maxVal*100)).toFixed(1):2;
        return `<div title="${v.plate}: ${val.toFixed(1)}L" style="width:20px;height:${h}%;background:${VEHICLE_COLORS[vi%VEHICLE_COLORS.length]};border-radius:2px 2px 0 0;opacity:0.85"></div>`;
      }).join('');
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1"><div style="display:flex;align-items:flex-end;gap:2px;height:100px">${groupBars}</div><div style="font-family:var(--mono);font-size:9px;color:var(--text3)">${label}</div></div>`;
    }).join('');
    histEl.innerHTML=`<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap">${legend}</div><div style="display:flex;align-items:flex-end;gap:4px;height:120px;padding-bottom:20px">${bars}</div>`;
  }catch(err){console.error('Chart:',err);}
}

/* ─── FAKTURY ─── */
let invoiceScannedItems=[], invoiceSuppliers=[];

async function loadSuppliers() {
  try{
    invoiceSuppliers=await api('GET','/invoices/suppliers')||[];
    const sel=$('inv-supplier');
    if(!sel) return;
    sel.innerHTML='<option value="">-- wybierz --</option>';
    invoiceSuppliers.forEach(s=>{const opt=document.createElement('option');opt.value=s.id;opt.textContent=`${s.name} (${s.currency})`;sel.appendChild(opt);});
  }catch(e){}
}

async function loadInvoices() {
  const month=$('inv-filter-month')?$('inv-filter-month').value:'';
  const tbody=$('invoices-table');
  if(!tbody) return;
  tbody.innerHTML='<tr><td colspan="8"><div class="loading">Ładowanie...</div></td></tr>';
  try{
    const data=await api('GET','/invoices'+(month?'?month='+month:''));
    if(!data||!data.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty"><div class="empty-icon">🧾</div><div>Brak faktur. Wgraj pierwszą fakturę.</div></div></td></tr>';return;}
    tbody.innerHTML=data.map(inv=>`<tr>
      <td class="mono">${inv.month}</td>
      <td><strong>${inv.supplier_name}</strong></td>
      <td style="color:var(--text2);font-size:12px">${inv.invoice_no||'—'}</td>
      <td class="mono">${inv.item_count}</td>
      <td class="mono">${fmtNum(inv.total_liters,2)} L</td>
      <td class="mono">${fmtNum(inv.total_net,2)} zł</td>
      <td class="mono" style="color:var(--accent)">${fmtNum(inv.total_gross,2)} zł</td>
      <td><button class="btn-danger" onclick="deleteInvoice(${inv.id})">✕</button></td>
    </tr>`).join('');
  }catch(e){tbody.innerHTML='<tr><td colspan="8"><div class="empty">Błąd ładowania</div></td></tr>';}
}

async function deleteInvoice(id) {
  if(!confirm('Usunąć tę fakturę?')) return;
  await api('DELETE',`/invoices/${id}`);
  showToast('🗑️ Faktura usunięta');
  loadInvoices(); loadComparison();
}

/* ─── POROWNANIE ─── */
async function loadComparison() {
  const month=$('comp-month')?$('comp-month').value:'';
  try{
    const data=await api('GET','/invoices/comparison'+(month?'?month='+month:''));
    if(!data) return;
    const sel=$('comp-month');
    if(sel&&data.available_months){
      const cur=sel.value;
      sel.innerHTML=`<option value="">Bieżący miesiąc (${data.month})</option>`;
      data.available_months.forEach(m=>{const opt=document.createElement('option');opt.value=m;opt.textContent=m;sel.appendChild(opt);});
      if(cur) sel.value=cur;
    }
    const totalCard=data.card_data.reduce((s,r)=>s+(r.card_gross||0),0);
    const totalPump=data.pump_data.reduce((s,r)=>s+(r.pump_total||0),0);
    const totalSaving=totalPump-totalCard;
    const savingPct=totalPump>0?(totalSaving/totalPump*100):0;
    const statsEl=$('comp-stats');
    if(statsEl) statsEl.innerHTML=`
      <div class="stat-card"><div class="stat-label">Koszt karta (brutto)</div><div class="stat-value" style="color:var(--accent)">${fmtNum(totalCard,2)}</div><div class="stat-unit">PLN</div></div>
      <div class="stat-card blue"><div class="stat-label">Koszt dystrybutor</div><div class="stat-value">${fmtNum(totalPump,2)}</div><div class="stat-unit">PLN</div></div>
      <div class="stat-card green"><div class="stat-label">Oszczędność</div><div class="stat-value">${fmtNum(totalSaving,2)}</div><div class="stat-unit">PLN / ${fmtNum(savingPct,1)}%</div></div>
      <div class="stat-card"><div class="stat-label">Miesiąc</div><div class="stat-value" style="font-size:18px">${data.month}</div><div class="stat-unit">rozliczany</div></div>`;
    const suppEl=$('comp-suppliers-table');
    if(suppEl){
      if(!data.by_supplier||!data.by_supplier.length){suppEl.innerHTML='<tr><td colspan="4"><div class="empty">Brak faktur dla tego miesiąca</div></td></tr>';}
      else suppEl.innerHTML=data.by_supplier.map(s=>`<tr><td><strong>${s.supplier_name}</strong> <span style="font-family:var(--mono);font-size:10px;color:var(--text3)">${s.currency}</span></td><td class="mono">${fmtNum(s.total_liters,2)} L</td><td class="mono">${fmtNum(s.total_net,2)} zł</td><td class="mono" style="color:var(--accent)">${fmtNum(s.total_gross,2)} zł</td></tr>`).join('');
    }
    const tbody=$('comp-table');
    if(tbody){
      const allPlates=new Set(); const cardMap={}, pumpMap={};
      data.card_data.forEach(r=>{allPlates.add(r.plate);cardMap[r.plate]=r;});
      data.pump_data.forEach(r=>{allPlates.add(r.plate);pumpMap[r.plate]=r;});
      if(!allPlates.size){tbody.innerHTML='<tr><td colspan="8"><div class="empty">Brak danych</div></td></tr>';}
      else tbody.innerHTML=Array.from(allPlates).sort().map(plate=>{
        const c=cardMap[plate]||{}, p=pumpMap[plate]||{};
        const cardGross=c.card_gross||0, pumpTotal=p.pump_total||0;
        const saving=pumpTotal-cardGross;
        const savPct=pumpTotal>0?(saving/pumpTotal*100):0;
        const savColor=saving>0?'#2ecc71':saving<0?'#e74c3c':'var(--text3)';
        return `<tr>
          <td><div class="vehicle-name" style="font-size:13px">${plate}</div><div style="font-size:11px;color:var(--text3)">${c.vehicle_name||p.vehicle_name||''}</div></td>
          <td class="mono">${plate}</td>
          <td class="mono" style="color:var(--accent)">${c.card_liters?fmtNum(c.card_liters,2)+' L':'—'}</td>
          <td class="mono" style="color:var(--accent)">${cardGross?fmtNum(cardGross,2)+' zł':'—'}</td>
          <td class="mono" style="color:#3498db">${p.pump_liters?fmtNum(p.pump_liters,2)+' L':'—'}</td>
          <td class="mono" style="color:#3498db">${pumpTotal?fmtNum(pumpTotal,2)+' zł':'—'}</td>
          <td class="mono" style="color:${savColor};font-weight:700">${saving?fmtNum(saving,2)+' zł':'—'}</td>
          <td class="mono" style="color:${savColor}">${savPct?fmtNum(savPct,1)+'%':'—'}</td>
        </tr>`;
      }).join('');
    }
  }catch(e){console.error('Comparison:',e);}
}

/* AUTO-KURS NBP */
async function fetchNbpRate(currency) {
  if(!currency || currency === 'PLN') {
    if($('inv-eur')) $('inv-eur').value = '1.0000';
    if($('inv-eur-label')) $('inv-eur-label').textContent = 'Kurs (PLN = 1)';
    return;
  }
  try {
    const res = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/' + currency.toLowerCase() + '/?format=json');
    if(!res.ok) throw new Error('NBP error');
    const data = await res.json();
    const rate = data.rates[0].mid;
    const date = data.rates[0].effectiveDate;
    if($('inv-eur')) $('inv-eur').value = parseFloat(rate).toFixed(4);
    if($('inv-eur-label')) $('inv-eur-label').textContent = 'Kurs ' + currency + '/PLN (NBP ' + date + ')';
    showToast('Kurs ' + currency + '/PLN: ' + rate + ' (NBP ' + date + ')');
  } catch(e) {
    if($('inv-eur-label')) $('inv-eur-label').textContent = 'Kurs ' + currency + '/PLN';
  }
}

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', function() {

  document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.section)));

  $('btn-logout') && $('btn-logout').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login.html';});

  $('btn-add-vehicle') && $('btn-add-vehicle').addEventListener('click',()=>openVehicleModal());
  $('btn-cancel-vehicle') && $('btn-cancel-vehicle').addEventListener('click',()=>$('modal-vehicle').classList.remove('open'));
  $('btn-save-vehicle') && $('btn-save-vehicle').addEventListener('click',saveVehicle);

  $('btn-add-refuel') && $('btn-add-refuel').addEventListener('click',()=>openRefuelModal());
  $('btn-add-refuel2') && $('btn-add-refuel2').addEventListener('click',()=>openRefuelModal());
  $('btn-cancel-refuel') && $('btn-cancel-refuel').addEventListener('click',()=>$('modal-refuel').classList.remove('open'));
  $('btn-save-refuel') && $('btn-save-refuel').addEventListener('click',saveRefuel);

  $('btn-export') && $('btn-export').addEventListener('click',exportCSV);

  $('filter-vehicle') && $('filter-vehicle').addEventListener('change',loadRefuels);
  $('filter-fuel') && $('filter-fuel').addEventListener('change',loadRefuels);
  $('filter-month') && $('filter-month').addEventListener('change',loadRefuels);

  $('btn-scan') && $('btn-scan').addEventListener('click',openScanModal);
  $('btn-cancel-scan') && $('btn-cancel-scan').addEventListener('click',()=>{
    scanFiles=[]; scannedData=null;
    $('scan-previews').innerHTML='';
    $('scan-result').classList.remove('show');
    $('scan-analyzing').classList.remove('show');
    $('scan-vehicle-row').style.display='none';
    $('btn-analyze').style.display='';
    $('btn-analyze').disabled=true;
    $('btn-scan-save').style.display='none';
    $('scan-input').value='';
    $('scan-tankpool').checked=false;
    const ri=$('sr-rate-info'); if(ri) ri.style.display='none';
    $('modal-scan').classList.remove('open');
  });

  $('btn-add-invoice') && $('btn-add-invoice').addEventListener('click',()=>{
    invoiceScannedItems=[];
    $('inv-no').value='';
    $('inv-month').value=new Date().toISOString().slice(0,7);
    $('inv-file').value='';
    $('inv-result').style.display='none';
    $('inv-analyzing').style.display='none';
    $('btn-analyze-invoice').style.display='';
    $('btn-analyze-invoice').disabled=false;
    $('btn-save-invoice').style.display='none';
    if($('inv-currency')) $('inv-currency').value='EUR';
    fetchNbpRate('EUR');
    loadSuppliers();
    $('modal-invoice').classList.add('open');
  });

  $('inv-currency') && $('inv-currency').addEventListener('change', function() {
    fetchNbpRate(this.value);
  });

  $('inv-supplier') && $('inv-supplier').addEventListener('change', function() {
    const supplierId = parseInt(this.value);
    const supplier = invoiceSuppliers.find(s => s.id === supplierId);
    if(supplier && $('inv-currency')) {
      $('inv-currency').value = supplier.currency || 'EUR';
      fetchNbpRate(supplier.currency || 'EUR');
    }
  });

  $('btn-cancel-invoice') && $('btn-cancel-invoice').addEventListener('click',()=>$('modal-invoice').classList.remove('open'));

  $('btn-analyze-invoice') && $('btn-analyze-invoice').addEventListener('click',async()=>{
    const supplierId=$('inv-supplier').value, month=$('inv-month').value, file=$('inv-file').files[0];
    if(!supplierId||!month||!file){showToast('Wypełnij wymagane pola i wybierz plik');return;}
    $('inv-analyzing').style.display='flex';
    $('btn-analyze-invoice').disabled=true;
    try{
      const fd=new FormData();
      fd.append('file',file);
      fd.append('supplier_id',supplierId);
      fd.append('month',month);
      fd.append('invoice_currency',$('inv-currency')?$('inv-currency').value:'EUR');
      fd.append('eur_rate',$('inv-eur').value||'4.25');
      const res=await fetch('/api/invoices/scan',{method:'POST',body:fd});
      const json=await res.json();
      if(!json.ok) throw new Error(json.error||'Błąd analizy');
      invoiceScannedItems=json.items||[];
      if(!invoiceScannedItems.length){showToast('Nie odczytano żadnych pozycji');$('btn-analyze-invoice').disabled=false;return;}
      const tbody=$('inv-items-table');
      tbody.innerHTML=invoiceScannedItems.map((item,i)=>`<tr>
        <td><input type="text" value="${item.plate||''}" data-i="${i}" data-field="plate" style="width:100px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:4px 6px;border-radius:4px;font-size:12px"></td>
        <td><input type="number" value="${item.liters||''}" data-i="${i}" data-field="liters" step="0.01" style="width:80px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:4px 6px;border-radius:4px;font-family:var(--mono);font-size:12px"></td>
        <td><input type="number" value="${item.net_amount||''}" data-i="${i}" data-field="net_amount" step="0.01" style="width:90px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:4px 6px;border-radius:4px;font-family:var(--mono);font-size:12px"></td>
        <td><input type="number" value="${item.gross_amount||''}" data-i="${i}" data-field="gross_amount" step="0.01" style="width:90px;background:var(--bg3);border:1px solid var(--border2);color:var(--accent);padding:4px 6px;border-radius:4px;font-family:var(--mono);font-size:12px"></td>
        <td style="font-size:11px;color:var(--text2)">${item.vehicle_name||'<span style="color:var(--text3)">nie dopasowano</span>'}</td>
      </tr>`).join('');
      tbody.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',function(){
        const i=parseInt(this.dataset.i), field=this.dataset.field;
        invoiceScannedItems[i][field]=field==='plate'?this.value:parseFloat(this.value);
      }));
      $('inv-result').style.display='block';
      $('btn-save-invoice').style.display='';
      showToast(`Odczytano ${invoiceScannedItems.length} pozycji`);
    }catch(e){showToast('❌ Błąd: '+e.message);$('btn-analyze-invoice').disabled=false;}
    finally{$('inv-analyzing').style.display='none';$('btn-analyze-invoice').disabled=false;}
  });

  $('btn-save-invoice') && $('btn-save-invoice').addEventListener('click',async()=>{
    if(!invoiceScannedItems.length){showToast('Brak pozycji');return;}
    try{
      await api('POST','/invoices',{
        supplier_id:parseInt($('inv-supplier').value),
        invoice_no:$('inv-no').value||null,
        month:$('inv-month').value,
        invoice_currency:$('inv-currency')?$('inv-currency').value:'EUR',
        eur_rate:parseFloat($('inv-eur').value)||4.25,
        items:invoiceScannedItems,
      });
      showToast('✅ Faktura zapisana!');
      $('modal-invoice').classList.remove('open');
      loadInvoices(); loadComparison();
    }catch(e){showToast('❌ '+e.message);}
  });

  $('comp-month') && $('comp-month').addEventListener('change',loadComparison);
  $('inv-filter-month') && $('inv-filter-month').addEventListener('change',loadInvoices);

  document.querySelectorAll('.modal-overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o) o.classList.remove('open');}));

  updateFleetCount();
  loadDashboard();
});
