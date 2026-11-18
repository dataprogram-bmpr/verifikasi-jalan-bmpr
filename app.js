'use strict';
/* BMPR Verifikasi Jalan — offline-first prototype. No third-party libraries. */
const $=id=>document.getElementById(id);
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const empty='—', safeText=v=>escapeHTML(v||empty);
const DB_NAME='bmpr-verifikasi-offline-v1', STORE='records';
const DOC_TYPES=['Surat usulan kepala daerah','DED / RAB','Dokumen lingkungan','Peta ruas / lokasi','SK penetapan jalan (jika ada)'];
const PHOTO_LIMIT=60, PHOTO_MAX=18*1024*1024;
let db=null, current=null, saveTimer=null, saving=false, pendingSave=false;
let apiBase=localStorage.getItem('bmpr_api_base')||'', token=sessionStorage.getItem('bmpr_session')||'', account=null;
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uid=()=>crypto.randomUUID();
const fmtSta=m=>{let n=Number(m); if(!Number.isFinite(n)||n<0)return '—';return `${Math.floor(n/1000)}+${String(Math.round(n%1000)).padStart(3,'0')}`};
const lengthSeg=s=>{let a=Number(s.start),b=Number(s.end);return s.start!==''&&s.end!==''&&Number.isFinite(a)&&Number.isFinite(b)&&b>a?(b-a):0};
const km=m=>(m/1000).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:3})+' km';
const stamp=()=>new Date().toISOString();
const statuses={ya:'Perlu penanganan',tidak:'Tidak perlu penanganan',evaluasi:'Perlu evaluasi'};
function freshRecord(){return{id:uid(),revision:0,owner:'',updatedAt:stamp(),dirty:true,conflict:false,sample:false,fields:{tanggal:today()},team:[],segments:[],photos:[],docs:DOC_TYPES.map(name=>({name,status:'',note:''}))}};
function copyRecord(r){return structuredClone(r)};
function openDatabase(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function transaction(mode,handler){return new Promise((resolve,reject)=>{let tx=db.transaction(STORE,mode),store=tx.objectStore(STORE),result;try{result=handler(store)}catch(err){reject(err);return}tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error)})}
const saveRec=rec=>transaction('readwrite',s=>s.put(copyRecord(rec)));
const getRec=id=>new Promise((resolve,reject)=>{let t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
const allRecs=()=>new Promise((resolve,reject)=>{let t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});
const deleteRec=id=>transaction('readwrite',s=>s.delete(id));
function toast(msg){let t=$('toast');t.textContent=msg;t.style.display='block';clearTimeout(toast._timer);toast._timer=setTimeout(()=>t.style.display='none',4200)}
function notice(msg){$('message').textContent=msg;$('message').classList.toggle('visible',!!msg)}
function badge(el,text,kind=''){$(el).textContent=text;$(el).className='pill '+kind}
function onlineState(){badge('netBadge',navigator.onLine?'Perangkat online':'Perangkat offline',navigator.onLine?'good':'warn')}
function authState(){badge('loginBadge',account?`Login: ${account.username}`:'Belum login online',account?'good':'warn');$('adminSection').hidden=!(account?.role==='admin')}
function saveState(){if(!current){badge('saveBadge','Belum membuka ruas');return}let type=current.conflict?'bad':current.dirty?'warn':'good';badge('saveBadge',current.conflict?'Konflik server':current.dirty?'Tersimpan di perangkat • Belum sinkron':'Tersinkron',type);$('sideStatus').textContent=`ID: ${current.id}\n${current.dirty?'Belum sinkron / ada perubahan lokal':'Sudah disinkronkan'}\nRevisi server: ${current.revision}`}
function markDirty(){if(!current)return;current.dirty=true;current.updatedAt=stamp();saveState();queueSave();updateHeader()}
function queueSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow(),350)}
async function saveNow(){clearTimeout(saveTimer);if(!current)return;if(saving){pendingSave=true;return}saving=true;const item=copyRecord(current);try{await saveRec(item)}catch(err){notice('Gagal menyimpan di perangkat: '+err.message)}finally{saving=false;if(pendingSave){pendingSave=false;queueSave()}}}
function showPage(page){$('listView').hidden=page!=='list';$('formView').hidden=page!=='form';window.scrollTo({top:0,behavior:'instant'})}
function updateHeader(){if(!current)return;$('currentTitle').textContent=current.fields.namaRuas||'Ruas baru';$('currentId').textContent=`ID: ${current.id} · Revisi server: ${current.revision}`}
function loadInputs(){if(!current)return;document.querySelectorAll('[data-field]').forEach(el=>{el.value=current.fields[el.dataset.field]??''});renderEverything()}
function renderEverything(){updateHeader();saveState();renderTeam();renderSegments();renderPhotos();renderDocs();summary();$('photoSummary').innerHTML=`Foto tersimpan: <strong>${current.photos.filter(p=>p.data).length}</strong> di perangkat, total <strong>${current.photos.length}</strong> metadata foto. Lampiran dicetak otomatis.`}
async function openRecord(id){await saveNow();const record=await getRec(id);if(!record){toast('Ruas tidak ditemukan di perangkat.');return}current=record;current.team ||= [];loadInputs();showPage('form');if(navigator.onLine&&token&&current.photos.some(p=>!p.data&&p.remoteUploaded))notice('Sebagian foto hanya ada di server. Tekan “Unduh foto untuk offline” sebelum berangkat ke lokasi tanpa sinyal.');else notice('')}
async function newRecord(){await saveNow();current=freshRecord();await saveRec(current);loadInputs();showPage('form');toast('Form baru tersimpan di perangkat ini.');}
async function renderList(){let records=await allRecs();let q=$('searchBox').value.toLowerCase().trim(),f=$('filterStatus').value;records=records.filter(r=>`${r.fields?.namaRuas||''} ${r.fields?.kabupaten||''}`.toLowerCase().includes(q)).filter(r=>!f||(f==='local'?r.dirty&&!r.conflict:f==='conflict'?r.conflict:!r.dirty)).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));$('recordsList').innerHTML=records.length?records.map(r=>{let s=r.conflict?'Konflik • perlu ditangani':r.dirty?'Di perangkat • menunggu sinkron':'Tersinkron';let c=r.conflict?'bad':r.dirty?'warn':'good';return`<div class="record"><div><h3>${safeText(r.fields?.namaRuas||'Ruas tanpa nama')}</h3><p>${safeText(r.fields?.kabupaten||'Belum ada lokasi')} · ${safeText(r.fields?.tanggal||'Tanggal belum diisi')} · ${r.segments?.length||0} segmen · ${r.photos?.length||0} foto</p><span class="pill ${c}">${s}</span></div><div class="stack"><button class="btn small" data-open-record="${r.id}">Buka</button><button class="btn small" data-export-record="${r.id}">Cadangan</button><button class="btn small danger" data-delete-record="${r.id}">Hapus dari HP</button></div></div>`}).join(''):'<div class="emptystate">Belum ada formulir yang cocok. Tekan “Tambah ruas” untuk mulai mencatat.</div>'}
function calc(){let total=0,yes=0,review=0,errors=[],ranges=[];for(let [i,s] of current.segments.entries()){let len=lengthSeg(s);if(s.start!==''&&s.end!==''&&!len)errors.push(`Segmen ${i+1}: STA akhir harus lebih besar dari STA awal.`);if(len){total+=len;if(s.need==='ya')yes+=len;if(s.need==='evaluasi')review+=len;ranges.push({a:+s.start,b:+s.end,i:i+1})}}ranges.sort((a,b)=>a.a-b.a);for(let i=1;i<ranges.length;i++)if(ranges[i].a<ranges[i-1].b)errors.push(`STA segmen ${ranges[i-1].i} dan ${ranges[i].i} bertumpang tindih.`);if(current.fields.panjangUsulan&&ranges.some(r=>r.b>Number(current.fields.panjangUsulan)*1000+1))errors.push('Ada segmen di luar panjang ruas menurut usulan; periksa STA.');return{total,yes,review,errors}}
function summary(){if(!current)return;let c=calc();$('sumInspected').textContent=current.fields.panjangDiperiksa?String(current.fields.panjangDiperiksa).replace('.',',')+' km':'—';$('sumTreatment').textContent=km(c.yes);$('sumReview').textContent=km(c.review);$('sumSegs').textContent=String(current.segments.length);$('segErrors').textContent=c.errors.join(' ')}
const opts=(values,active)=>values.map(([v,label])=>`<option value="${escapeHTML(v)}" ${v===active?'selected':''}>${escapeHTML(label)}</option>`).join('');
const select=(field,items,v)=>`<select data-seg-field="${field}">${opts(items,v)}</select>`;
const conditionOptions=[['','Pilih'],['Baik','Baik'],['Sedang','Sedang'],['Rusak ringan','Rusak ringan'],['Rusak berat','Rusak berat']];
const surfaceOptions=[['','Pilih'],['Aspal','Aspal'],['Beton','Beton'],['Kerikil','Kerikil'],['Tanah','Tanah'],['Campuran','Campuran']];
const drainOptions=[['','Pilih'],['Baik','Baik'],['Sedang','Sedang'],['Buruk','Buruk'],['Tidak ada','Tidak ada'],['Tidak diperiksa','Tidak diperiksa']];
const defects=['Lubang','Retak','Permukaan terkelupas','Amblas / deformasi','Erosi / gerusan','Genangan','Longsor','Lainnya'];
function renderSegments(){if(!current)return;$('segments').innerHTML=current.segments.map((s,i)=>`<div class="segment" data-sid="${s.id}"><div class="seghead"><div class="stack"><strong>Segmen ${String(i+1).padStart(2,'0')}</strong><span class="chip">${s.start!==''&&s.end!==''?`STA ${fmtSta(s.start)} – ${fmtSta(s.end)}`:'STA belum ditentukan'}</span></div><button type="button" data-remove-seg="${s.id}" class="btn small danger">Hapus segmen</button></div>
<div class="fields two"><label>STA awal (meter dari pangkal) <b>*</b><input data-seg-field="start" type="number" min="0" step="1" value="${escapeHTML(s.start)}" placeholder="0"></label><label>STA akhir (meter dari pangkal) <b>*</b><input data-seg-field="end" type="number" min="0" step="1" value="${escapeHTML(s.end)}" placeholder="500"></label><label>Panjang segmen <small>(Otomatis)</small><input value="${km(lengthSeg(s))}" readonly></label><label>Lebar perkerasan (m) <b>*</b><input data-seg-field="width" type="number" min="0" step="0.01" value="${escapeHTML(s.width)}" placeholder="4.0"></label>
<label>Jenis permukaan <b>*</b>${select('surface',surfaceOptions,s.surface)}</label><label>Kondisi visual <b>*</b>${select('condition',conditionOptions,s.condition)}</label><label>Nilai ukuran <b>*</b>${select('measurement',[['','Pilih'],['Ukur','Diukur'],['Taksiran','Taksiran']],s.measurement)}</label><label>Kebutuhan penanganan <b>*</b>${select('need',[['','Pilih'],['ya','Ya'],['tidak','Tidak'],['evaluasi','Perlu evaluasi']],s.need)}</label>
<label>Kondisi bahu <small>(Opsional)</small><input data-seg-field="shoulder" value="${escapeHTML(s.shoulder)}" placeholder="Kiri/kanan jika ada"></label><label>Kondisi drainase <b>*</b>${select('drainage',drainOptions,s.drainage)}</label>
<div class="wide">Jenis kerusakan <small>(pilih yang terlihat)</small><span class="ticklist">${defects.map(d=>`<label><input type="checkbox" data-defect="${escapeHTML(d)}" ${(s.defects||[]).includes(d)?'checked':''}>${escapeHTML(d)}</label>`).join('')}</span></div><label class="wide">Tindak lanjut awal <small>(Wajib jika perlu penanganan)</small><textarea data-seg-field="note" rows="2" placeholder="Temuan dan penanganan yang perlu dikaji lebih lanjut">${escapeHTML(s.note)}</textarea></label></div><div class="seginfo">Foto segmen terkait: ${current.photos.filter(p=>p.role==='segmen'&&p.segmentId===s.id).length} foto</div>${photoCards(current.photos.filter(p=>p.role==='segmen'&&p.segmentId===s.id))}<label class="fileupload"><span class="btn small">＋ Tambah foto segmen</span><input type="file" accept="image/*" data-upload-role="segmen" data-seg-id="${s.id}" multiple></label></div>`).join('')||'<div class="emptystate">Belum ada segmen. Catat bagian yang diperiksa untuk menentukan kebutuhan penanganan.</div>';summary()}
function photoCards(list){return list.map(p=>`<div class="photocard" data-pid="${p.id}"><div class="ph-title"><span>${p.role==='pangkal'?'Foto pangkal':p.role==='ujung'?'Foto ujung':'Foto kerusakan'} <span class="micro">${p.remoteUploaded?'· Ada di server':''}</span></span><button type="button" class="btn small danger" data-remove-photo="${p.id}">Hapus</button></div><div class="photoimg">${safeImage(p.data)?`<img alt="Dokumentasi jalan" src="${p.data}">`:'Foto tidak ada di perangkat (unduh saat online)'}</div><div class="photoform"><label class="wide">Keterangan foto <b>*</b><input data-photo-field="caption" value="${escapeHTML(p.caption||'')}" placeholder="Contoh: lubang di jalur kanan"></label><label>Koordinat <small>(Opsional)</small><input data-photo-field="coords" value="${escapeHTML(p.coords||'')}" placeholder="Lintang, bujur"></label><label>Arah foto <small>(Opsional)</small><input data-photo-field="direction" value="${escapeHTML(p.direction||'')}" placeholder="Ke arah ujung ruas"></label></div><button class="btn small" type="button" data-photo-gps="${p.id}">Ambil GPS foto</button></div>`).join('')}
function renderPhotos(){if(!current)return;for(let role of ['pangkal','ujung']){let p=current.photos.find(x=>x.role===role);let root=$(role==='pangkal'?'photoPangkal':'photoUjung');root.innerHTML=`<div class="photocard"><div class="ph-title">${role==='pangkal'?'Pangkal ruas (STA 0+000)':'Ujung ruas (STA akhir)'}</div>${p?photoCards([p]):'<div class="photoimg">Belum ada foto</div>'}<label class="fileupload"><span class="btn small">${p?'Ganti foto':'Ambil / pilih foto'}</span><input type="file" accept="image/*" data-upload-role="${role}"></label></div>`}let n=current.photos.filter(p=>p.data).length;$('photoSummary').innerHTML=`Foto tersedia di perangkat: <strong>${n}</strong> dari <strong>${current.photos.length}</strong>. Urutan cetak: pangkal, ujung, lalu foto segmen.`}
function renderTeam(){
 if(!current)return;
 current.team ||= [];
 $('teamMembers').innerHTML = current.team.length ? current.team.map((t,i)=>`<div class="teamrow" data-team-i="${i}"><label>Nama anggota tim <b>*</b><input data-team-field="name" value="${escapeHTML(t.name||'')}" placeholder="Nama lengkap"></label><label>Jabatan / instansi <small>(Opsional)</small><input data-team-field="job" value="${escapeHTML(t.job||'')}" placeholder="Jabatan di tim"></label><button class="btn small danger" type="button" data-remove-team="${i}" aria-label="Hapus anggota tim ke-${i+1}">Hapus</button></div>`).join(''):'<div class="micro">Belum ada anggota tim. Tekan Tambah anggota tim.</div>';
}
function renderDocs(){if(!current)return;$('docs').innerHTML=current.docs.map((d,i)=>`<div class="docsrow" data-doc-i="${i}"><div class="name">${escapeHTML(d.name)}</div><select data-doc-field="status">${opts([['','Belum dinilai'],['T','Ditunjukkan'],['D','Dinyatakan ada, belum dilihat'],['B','Belum tersedia'],['R','Tidak relevan']],d.status)}</select><input data-doc-field="note" value="${escapeHTML(d.note||'')}" placeholder="Nomor / tahun / catatan (opsional)"></div>`).join('')}
function safeImage(s){return typeof s==='string'&&s.length<6000000&&/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(s)}
function readImage(file){return new Promise((resolve,reject)=>{if(!file.type.startsWith('image/')||file.size>PHOTO_MAX){reject(Error('Foto harus berupa gambar dan maksimum 18 MB sebelum kompresi.'));return}const fr=new FileReader();fr.onerror=()=>reject(Error('Foto gagal dibaca'));fr.onload=()=>{const img=new Image();img.onerror=()=>reject(Error('Format foto tidak didukung'));img.onload=()=>{try{let factor=Math.min(1,1350/Math.max(img.width,img.height));let canvas=document.createElement('canvas');canvas.width=Math.round(img.width*factor);canvas.height=Math.round(img.height*factor);let ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.76))}catch(e){reject(e)}};img.src=fr.result};fr.readAsDataURL(file)})}
async function acceptPhotos(files,role,segId){if(!current)return;let accepted=0;for(let file of files){if(current.photos.length>=PHOTO_LIMIT){toast('Batas maksimal 60 foto per ruas.');break}let existing=(role==='pangkal'||role==='ujung')?current.photos.find(p=>p.role===role):null;try{let data=await readImage(file);if(existing){existing.data=data;existing.remoteUploaded=false;existing.createdAt=stamp()}else current.photos.push({id:uid(),role,segmentId:segId||null,data,caption:'',coords:'',direction:'',createdAt:stamp(),remoteUploaded:false});accepted++}catch(e){notice('Gagal membaca '+file.name+': '+e.message)}}if(accepted){markDirty();await saveNow();renderSegments();renderPhotos();toast(`${accepted} foto tersimpan di perangkat.`)}}
async function removePhoto(photoId){if(!confirm('Hapus foto dari formulir?'))return;current.photos=current.photos.filter(p=>p.id!==photoId);markDirty();renderSegments();renderPhotos()}
function geolocate(cb){if(!navigator.geolocation){toast('GPS perangkat tidak tersedia.');return}navigator.geolocation.getCurrentPosition(pos=>cb(`${pos.coords.latitude.toFixed(7)}, ${pos.coords.longitude.toFixed(7)}`),e=>toast('GPS tidak tersedia: '+e.message),{enableHighAccuracy:true,maximumAge:0,timeout:20000})}
function onFieldChange(e){
 if(!current)return;
 const el=e.target,f=el.dataset.field;
 if(f){
   current.fields[f]=el.value;
   if((f==='pangkal'||f==='ujung')&&!current.fields.arahSta&&current.fields.pangkal&&current.fields.ujung){
     current.fields.arahSta=`${current.fields.pangkal} menuju ${current.fields.ujung}`;
     document.querySelector('[data-field=arahSta]').value=current.fields.arahSta;
   }
   markDirty();summary();return;
 }
 // Foto di dalam kartu segmen tetap harus mengubah objek foto, bukan objek segmen.
 const phRoot=el.closest('[data-pid]');
 if(phRoot&&el.dataset.photoField){
   const p=current.photos.find(x=>x.id===phRoot.dataset.pid);
   if(p){p[el.dataset.photoField]=el.value;markDirty()}
   return;
 }
 const segRoot=el.closest('[data-sid]');
 if(segRoot){
   const s=current.segments.find(x=>x.id===segRoot.dataset.sid);
   if(!s)return;
   if(el.dataset.segField)s[el.dataset.segField]=el.value;
   if(el.dataset.defect){
     s.defects=s.defects||[];
     s.defects=el.checked?[...new Set([...s.defects,el.dataset.defect])]:s.defects.filter(x=>x!==el.dataset.defect);
   }
   markDirty();
   if(el.dataset.segField==='start'||el.dataset.segField==='end'){
     let readonly=segRoot.querySelector('input[readonly]');if(readonly)readonly.value=km(lengthSeg(s));
     let chip=segRoot.querySelector('.chip');if(chip)chip.textContent=s.start!==''&&s.end!==''?`STA ${fmtSta(s.start)} – ${fmtSta(s.end)}`:'STA belum ditentukan';
   }
   summary();return;
 }
 const teamRoot=el.closest('[data-team-i]');
 if(teamRoot&&el.dataset.teamField){let t=(current.team||[])[Number(teamRoot.dataset.teamI)];if(t){t[el.dataset.teamField]=el.value;markDirty()}return}
 const docRoot=el.closest('[data-doc-i]');
 if(docRoot&&el.dataset.docField){const d=current.docs[Number(docRoot.dataset.docI)];if(d){d[el.dataset.docField]=el.value;markDirty()}}
}

function reportTable(rows){return`<table class="rtable"><tbody>${rows.join('')}</tbody></table>`}
const repRow=(a,b,c,d)=>`<tr><td class="rl">${escapeHTML(a)}</td><td>${safeText(b)}</td><td class="rl">${escapeHTML(c)}</td><td>${safeText(d)}</td></tr>`;
const repFull=(a,b)=>`<tr><td class="rl">${escapeHTML(a)}</td><td colspan="3">${safeText(b)}</td></tr>`;
const repSec=t=>`<div class="rsection">${escapeHTML(t)}</div>`;
/* Builder cetak Folio/F4. Tidak menggunakan CDN, bekerja secara offline. */
/* Builder cetak Folio/F4. Tidak menggunakan CDN, bekerja secara offline. */
function buildReport(){
  const f=current.fields||{}, c=calc(), logo='./icons/lambang-sulteng.png';
  const logoHeader=()=>`<div class="rhead"><img src="${logo}" alt="Lambang Provinsi Sulawesi Tengah"><div><div class="one">PEMERINTAH PROVINSI SULAWESI TENGAH</div><div class="two">DINAS BINA MARGA DAN PENATAAN RUANG</div><div class="three">Jl. Towua No. 85, Palu</div></div></div>`;
  const formPage=(title,body)=>`<section class="rpage">${logoHeader()}${current.sample?'<div class="rflag">DATA SIMULASI — BUKAN HASIL PEMERIKSAAN</div>':''}<div class="rptitle">${escapeHTML(title)}</div>${body}</section>`;
  const line=(a,b)=>`<tr><td class="rl">${escapeHTML(a)}</td><td colspan="3">${safeText(b)}</td></tr>`;
  const two=(a,b,c,d)=>`<tr><td class="rl">${escapeHTML(a)}</td><td>${safeText(b)}</td><td class="rl">${escapeHTML(c)}</td><td>${safeText(d)}</td></tr>`;
  const table=(rows)=>`<table class="rtable"><tbody>${rows.join('')}</tbody></table>`;
  const sec=(title)=>`<div class="rsection">${escapeHTML(title)}</div>`;
  const split=(items,n)=>{const result=[];for(let i=0;i<items.length;i+=n)result.push(items.slice(i,i+n));return result};
  const photoIds=sid=>(current.photos||[]).filter(p=>p.segmentId===sid).map(p=>p.id.slice(0,8)).join(', ')||'—';
  const normalize=v=>String(v||'').trim();
  const members=(current.team||[]).filter(t=>normalize(t.name));
  // Compatibility with old offline drafts containing only the single examiner field.
  if(!members.length&&normalize(f.pemeriksa))members.push({name:f.pemeriksa,job:''});
  const pageOne=formPage('Form 1 — Identitas dan Pencocokan Usulan',
    sec('A. Identitas dan cakupan pemeriksaan')+
    table([two('Nama ruas',f.namaRuas,'Kabupaten/kota',f.kabupaten),two('Kecamatan',f.kecamatan,'Desa/kelurahan',f.desa),two('Nama di lapangan',f.namaLapangan,'Tanggal',f.tanggal),two('Kode ruas/SK',f.kodeSK,'Status jalan',f.statusJalan),line('Tim pemeriksa',members.map(t=>t.name).join('; ')||f.pemeriksa),two('Cuaca/waktu',f.cuaca,'Nomor usulan',f.nomorUsulan)])+
    sec('B. Pencocokan data usulan dan hasil pemeriksaan')+
    `<table class="rtable"><thead><tr><th style="width:18%">Objek</th><th>Menurut usulan kabupaten/kota</th><th>Temuan tim provinsi</th><th style="width:20%">Keterangan</th></tr></thead><tbody>`+
    `<tr><td>Ruas dan batas</td><td>${safeText(f.namaRuas)}<br>${safeText(f.pangkal)} — ${safeText(f.ujung)}</td><td>${safeText(f.namaLapangan||f.namaRuas)}<br>Pangkal: ${safeText(f.koorAwal)}<br>Ujung: ${safeText(f.koorAkhir)}</td><td>${safeText(f.kesesuaianLokasi)}</td></tr>`+
    `<tr><td>Panjang</td><td>Panjang ruas: ${safeText(f.panjangUsulan)} km<br><em>Panjang penanganan belum ditentukan</em></td><td>Panjang diperiksa: ${safeText(f.panjangDiperiksa)} km<br>Indikasi penanganan: ${km(c.yes)}<br>Perlu evaluasi: ${km(c.review)}</td><td>Hasil awal, berdasarkan segmen tercatat</td></tr>`+
    `<tr><td>Permukaan &amp; kondisi</td><td>${safeText(f.permukaanUsulan)}<br>${safeText(f.kondisiUsulan)}<br>${safeText(f.tahunKondisi)}</td><td>${safeText(f.permukaanLapangan)}<br>${safeText(f.kondisiLapangan)}</td><td>${safeText(f.kesesuaianKondisi)}</td></tr>`+
    `<tr><td>Penanganan</td><td>${safeText(f.jenisUsulan)}</td><td>${safeText(f.indikasiPenanganan)}</td><td>Indikasi awal, bukan keputusan desain</td></tr></tbody></table>`+
    sec('C. Acuan lokasi dan jangkauan pemeriksaan')+
    table([two('Pangkal / STA 0+000',f.koorAwal,'Ujung ruas',f.koorAkhir),two('Arah STA meningkat',f.arahSta||[f.pangkal,f.ujung].filter(Boolean).join(' menuju '),'Metode/perangkat ukur',f.metode),two('Panjang diperiksa',f.panjangDiperiksa?f.panjangDiperiksa+' km':'','Bagian belum diperiksa',f.belumDiperiksa)])+
    `<div class="rsum">Foto pangkal dan ujung ruas dicantumkan otomatis pada Form 3.</div>`
  );
  let parts=[pageOne];
  const allSegs=current.segments||[];
  const segPages=split(allSegs,6);
  if(!segPages.length)segPages.push([]);
  segPages.forEach((slice,page)=>{
    const rows=slice.map((s,i)=>`<tr><td>${page*6+i+1}</td><td>${fmtSta(s.start)}<br>s.d. ${fmtSta(s.end)}<br>${km(lengthSeg(s))}</td><td>${safeText(s.surface)}<br>${safeText(s.width)} m<br>${safeText(s.measurement)}</td><td>${safeText(s.condition)}<br>${safeText((s.defects||[]).join(', '))}</td><td>Drainase: ${safeText(s.drainage)}<br>Bahu: ${safeText(s.shoulder)}</td><td>${safeText(statuses[s.need])}<br>${safeText(s.note)}<br>Foto: ${escapeHTML(photoIds(s.id))}</td></tr>`).join('')||'<tr><td colspan="6">Belum ada segmen tercatat.</td></tr>';
    let body=sec(`A. Catatan kondisi segmen (lembar ${page+1} dari ${segPages.length})`)+
      `<table class="rtable"><thead><tr><th style="width:5%">No.</th><th style="width:18%">STA / panjang</th><th style="width:16%">Permukaan / lebar / U-T</th><th>Kondisi / kerusakan</th><th style="width:18%">Drainase / bahu</th><th>Indikasi kebutuhan / catatan</th></tr></thead><tbody>${rows}</tbody></table>`;
    if(page===0)body+=sec('B. Rekapitulasi pemeriksaan')+table([
      two('Panjang ruas usulan',f.panjangUsulan?f.panjangUsulan+' km':'','Panjang diperiksa',f.panjangDiperiksa?f.panjangDiperiksa+' km':''),
      two('Panjang segmen tercatat',km(c.total),'Indikasi penanganan',km(c.yes)),
      two('Perlu evaluasi',km(c.review),'Jumlah segmen',String(allSegs.length)),
      line('Titik khusus / hambatan akses',f.titikKhusus)
    ])+`<div class="rsum">Penilaian visual dan taksiran awal bukan hasil survei teknis definitif. Segmen yang belum diperiksa tidak otomatis dinilai baik.</div>`;
    parts.push(formPage('Form 2 — Kondisi Jalan Per Segmen',body));
  });
  const roleRank={pangkal:0,ujung:1,segmen:2};
  const photoList=(current.photos||[]).filter(p=>safeImage(p.data)).sort((a,b)=>(roleRank[a.role]??9)-(roleRank[b.role]??9));
  const photoPages=split(photoList,4);
  if(!photoPages.length)photoPages.push([]);
  photoPages.forEach((group,page)=>{
    const cards=group.map((p,i)=>{
      const segment=allSegs.find(s=>s.id===p.segmentId);
      const loc=p.role==='pangkal'?'Pangkal ruas — STA 0+000':p.role==='ujung'?'Ujung ruas':segment?`Segmen — STA ${fmtSta(segment.start)} s.d. ${fmtSta(segment.end)}`:'Segmen (belum ditentukan)';
      const coords=p.coords||(p.role==='pangkal'?f.koorAwal:p.role==='ujung'?f.koorAkhir:'');
      return `<div class="rphotoitem"><img src="${p.data}" alt="Dokumentasi lapangan"><div class="rphotodesc"><b>Foto ${page*4+i+1} · ${safeText(loc)}</b><div>ID: ${escapeHTML(p.id.slice(0,8))} · Koordinat: ${safeText(coords)}</div><div>Arah: ${safeText(p.direction)}</div><div>Keterangan: ${safeText(p.caption)}</div></div></div>`;
    }).join('')||'<div class="rnote">Belum terdapat foto di perangkat ini.</div>';
    parts.push(formPage('Form 3 — Dokumentasi Foto Lapangan',sec(`Lampiran foto (lembar ${page+1} dari ${photoPages.length})`)+`<div class="rphotogrid">${cards}</div>`));
  });
  const docs=(current.docs||[]).map(d=>`<tr><td>${escapeHTML(d.name||'')}</td><td>${safeText(({T:'Ditunjukkan',D:'Dinyatakan ada, belum dilihat',B:'Belum tersedia',R:'Tidak relevan'})[d.status]||'Belum dinilai')}</td><td>${safeText(d.note)}</td></tr>`).join('');
  parts.push(formPage('Form 4 — Keterhubungan dan Dokumen',
    sec('A. Keterhubungan dan manfaat ruas')+table([
      two('Menghubungkan dari',f.hubungDari,'Menuju',f.hubungKe),
      line('Sambungan dengan ruas lain',f.sambungan),
      line('Kawasan / layanan yang diakses',f.kawasan),
      line('Manfaat / urgensi penanganan',f.manfaat),
      line('Bagian terputus atau belum dilalui',f.bagianTerputus)
    ])+
    sec('B. Bukti dokumen pendukung')+
    `<table class="rtable"><thead><tr><th style="width:34%">Dokumen</th><th style="width:32%">Status</th><th>Nomor / tahun / catatan</th></tr></thead><tbody>${docs}</tbody></table>`+
    `<div class="rsum">Status dokumen mencatat hasil pemeriksaan ketersediaan; tidak berarti seluruh dokumen sudah diverifikasi keabsahannya.</div>`
  ));
  const signature=(arr,startIndex=0)=>`<table class="rtable rsignature"><thead><tr><th style="width:7%">No.</th><th>Nama anggota tim verifikasi</th><th>Jabatan/instansi</th><th style="width:26%">Tanda tangan</th></tr></thead><tbody>${arr.map((t,i)=>`<tr><td>${startIndex+i+1}</td><td>${safeText(t.name)}</td><td>${safeText(t.job)}</td><td class="signspace"></td></tr>`).join('')||'<tr><td>1</td><td>—</td><td>—</td><td class="signspace"></td></tr>'}</tbody></table>`;
  parts.push(formPage('Form 4 — Hasil Verifikasi dan Tindak Lanjut',
    sec('C. Kesimpulan pemeriksaan lapangan')+table([
      line('Kesesuaian usulan dengan kondisi lapangan',f.kesesuaianUsulan),
      line('Rekomendasi hasil verifikasi',f.kesimpulan),
      line('Bukti / selisih data',f.buktiSelisih),
      line('Dasar / alasan kesimpulan',f.alasanKesimpulan),
      line('Indikasi penanganan awal',f.indikasiPenanganan),
      line('Tindak lanjut / data tambahan',f.tindakLanjut),
      two('Penanggung jawab',f.pic,'Target waktu',f.target)
    ])+
    sec('D. Rekapitulasi panjang kebutuhan penanganan')+table([
      two('Panjang ruas usulan',f.panjangUsulan?f.panjangUsulan+' km':'','Panjang diperiksa',f.panjangDiperiksa?f.panjangDiperiksa+' km':''),
      two('Indikasi penanganan',km(c.yes),'Perlu evaluasi',km(c.review))
    ])+
    sec('E. Tim pemeriksa lapangan — tanda tangan')+signature(members.slice(0,5),0)
  ));
  split(members.slice(5),8).forEach((group,i)=>parts.push(formPage('Form 4 — Daftar Tanda Tangan (Lanjutan)',sec(`Tim pemeriksa — halaman tambahan ${i+1}`)+signature(group,5+i*8))));
  $('report').innerHTML=parts.join('');
}

function validateForPrint(){let must=['namaRuas','kabupaten','tanggal','pangkal','ujung','panjangUsulan','koorAwal','koorAkhir','panjangDiperiksa','permukaanLapangan','kondisiLapangan','hubungDari','hubungKe','kawasan','manfaat','kesesuaianUsulan','kesimpulan','alasanKesimpulan'];let missing=must.filter(f=>!String(current.fields[f]||'').trim());if(calc().errors.length){notice(calc().errors.join(' '));return false}
if(!(current.team||[]).some(t=>String(t.name||'').trim()) && !String(current.fields.pemeriksa||'').trim())missing.push('anggota tim');
if(current.docs.some(d=>!d.status))missing.push('status dokumen pendukung');
if(current.photos.some(p=>!String(p.caption||'').trim()))missing.push('keterangan foto');
if(missing.length&&!confirm(`Ada ${missing.length} isian wajib yang belum diisi. Cetak sebagai DRAF belum lengkap?`))return false;let blank=current.photos.filter(p=>!safeImage(p.data));if(blank.length&&!confirm(`${blank.length} foto belum ada di perangkat dan tidak akan muncul di PDF. Lanjut cetak?`))return false;return true}
function downloadJSON(r){let data=JSON.stringify({format:'bmpr-offline-1',record:r},null,2),blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Cadangan_Verifikasi_'+(r.fields.namaRuas||'Ruas').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,45)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2500)}
function recordSummary(r){return{id:r.id,fields:r.fields,segments:r.segments,docs:r.docs,photos:r.photos.map(({data,remoteUploaded,...meta})=>meta),team:r.team||[],sample:!!r.sample}}
async function downloadPhotos(){if(!current)return;if(!token){notice('Login online dulu untuk mengunduh foto server.');return}let pending=current.photos.filter(p=>!safeImage(p.data)&&p.remoteUploaded);if(!pending.length){toast('Semua foto ruas ini sudah tersedia offline.');return}let count=0;for(let p of pending){try{let res=await api(`/records/${current.id}/photos/${p.id}`,{method:'GET'});let blob=await res.blob();if(blob.size>PHOTO_MAX)throw Error('Foto terlalu besar');p.data=await blobAsDataURL(blob);count++}catch(e){notice('Sebagian foto belum berhasil diunduh: '+e.message)}}await saveNow();renderSegments();renderPhotos();toast(`${count} dari ${pending.length} foto berhasil dicache di perangkat.`)}
function blobAsDataURL(blob){return new Promise((yes,no)=>{let r=new FileReader();r.onload=()=>yes(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(blob)})}
function trimBase(v){return String(v||'').trim().replace(/\/+$/,'')}
async function api(path,init={}){if(!apiBase)throw Error('Alamat API belum diisi.');const headers={...(init.headers||{})};if(token)headers.Authorization=`Bearer ${token}`;let response;try{response=await fetch(apiBase+path,{...init,headers,cache:'no-store'})}catch(e){throw Error('Server tidak terjangkau. Data lokal tetap aman.')}if(response.status===401){token='';account=null;sessionStorage.removeItem('bmpr_session');authState();throw Error('Sesi online berakhir. Login kembali.')}if(!response.ok){let data;try{data=await response.json()}catch{}let err=Error(data?.error||`Kesalahan server (${response.status})`);err.status=response.status;err.info=data;throw err}return response}
async function login(){apiBase=trimBase($('apiUrl').value);const username=$('username').value.trim(),password=$('password').value;if(!apiBase.startsWith('https://')&&!apiBase.startsWith('http://localhost')){toast('Gunakan alamat API HTTPS yang benar.');return}try{localStorage.setItem('bmpr_api_base',apiBase);let resp=await api('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});let data=await resp.json();token=data.token;account=data.user;sessionStorage.setItem('bmpr_session',token);$('password').value='';$('authInfo').textContent='Login berhasil. Semua perangkat dapat membaca ruas tersinkron, tetapi hanya pemilik/admin yang dapat mengubah data server.';authState();$('authModal').hidden=true;toast('Login online berhasil. Tekan Sinkronkan untuk mengunggah data lokal.')}catch(e){$('authInfo').textContent=e.message;toast('Login gagal: '+e.message)}}
function logout(){token='';account=null;sessionStorage.removeItem('bmpr_session');authState();$('authInfo').textContent='Logout online. Data offline di perangkat tetap tersedia.'}
async function createUser(){if(account?.role!=='admin')return;try{let username=$('newUsername').value.trim(),password=$('newPassword').value;let response=await api('/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,role:'petugas'})});let result=await response.json();$('newUsername').value='';$('newPassword').value='';$('adminInfo').textContent=`Akun ${result.user.username} dibuat. Sampaikan sandi awal melalui jalur pribadi.`;toast('Akun petugas berhasil dibuat.')}catch(err){$('adminInfo').textContent=err.message}}
async function doSync(){if(!token){$('authModal').hidden=false;toast('Login online diperlukan sebelum sinkronisasi.');return}if(!navigator.onLine){toast('Perangkat sedang offline. Semua data tetap tersimpan di perangkat.');return}await saveNow();const btn=$('syncBtn');btn.disabled=true;btn.textContent='Sinkronisasi...';$('surveyForm').inert=true;let pushed=0,pulled=0,failures=[];try{const locals=await allRecs();for(let r of locals.filter(x=>x.dirty&&!x.conflict)){try{let resp=await api(`/records/${encodeURIComponent(r.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:r.revision||0,record:recordSummary(r)})});let res=await resp.json();r.revision=res.revision;r.owner=res.owner;r.updatedAt=stamp();await saveRec(r);for(let p of r.photos.filter(p=>safeImage(p.data)&&!p.remoteUploaded)){let blob=await(await fetch(p.data)).blob();await api(`/records/${encodeURIComponent(r.id)}/photos/${encodeURIComponent(p.id)}`,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:blob});p.remoteUploaded=true;await saveRec(r)}r.dirty=false;r.conflict=false;await saveRec(r);pushed++}catch(err){if(err.status===409){r.conflict=true;await saveRec(r)}failures.push(`${r.fields?.namaRuas||r.id}: ${err.message}`)}}
let reply=await api('/records');let json=await reply.json();for(let item of json.items||[]){let remote=item.record,local=await getRec(remote.id);if(!local){await saveRec({...remote,owner:item.owner,revision:item.revision,updatedAt:item.updatedAt,dirty:false,conflict:false,photos:(remote.photos||[]).map(p=>({...p,data:'',remoteUploaded:true}))});pulled++;continue}if(local.dirty){if((local.revision||0)<item.revision&&!local.conflict){local.conflict=true;await saveRec(local)}continue}if(item.revision>(local.revision||0)){const localById=new Map((local.photos||[]).map(p=>[p.id,p]));await saveRec({...remote,revision:item.revision,owner:item.owner,dirty:false,conflict:false,updatedAt:item.updatedAt,photos:(remote.photos||[]).map(p=>({...p,data:localById.get(p.id)?.data||'',remoteUploaded:true}))});pulled++}}if(current){let local=await getRec(current.id);if(local){current=local;loadInputs()}}await renderList();notice(failures.length?`${pushed} ruas terunggah, ${pulled} ruas diperbarui. Masalah: ${failures.join(' • ')}`:`Sinkronisasi selesai. ${pushed} ruas berhasil dikirim; ${pulled} ruas diambil dari server.`);toast(`Sinkron: ${pushed} unggah · ${pulled} terima`)}catch(e){notice('Sinkronisasi belum tuntas: '+e.message+' Data lokal tetap tersimpan.')}finally{$('surveyForm').inert=false;btn.disabled=false;btn.textContent='⟳ Sinkronkan';saveState()}}
function sanitizeImport(x){if(!x||typeof x!=='object'||!x.id||typeof x.fields!=='object'||!Array.isArray(x.segments)||!Array.isArray(x.photos))throw Error('Bukan format cadangan BMPR yang valid.');if(x.photos.length>PHOTO_LIMIT||x.segments.length>120)throw Error('Berkas cadangan terlalu besar.');let r=freshRecord();r.id=String(x.id);if(!/^[a-f0-9-]{30,50}$/i.test(r.id))r.id=uid();r.revision=Number(x.revision)||0;r.fields={...x.fields};r.team=Array.isArray(x.team)?x.team.slice(0,30).map(t=>({name:String(t.name||""),job:String(t.job||"")})):[];r.sample=!!x.sample;r.segments=x.segments.map(s=>({...s,id:String(s.id||uid()),defects:Array.isArray(s.defects)?s.defects:[]}));r.photos=x.photos.map(p=>({...p,id:String(p.id||uid()),data:safeImage(p.data)?p.data:'',remoteUploaded:!!p.remoteUploaded}));r.docs=DOC_TYPES.map((name,i)=>({...r.docs[i],...(x.docs?.[i]||{}),name}));r.owner=x.owner||'';r.dirty=true;r.conflict=false;r.updatedAt=stamp();return r}
async function importFile(file){if(file.size>100*1024*1024)throw Error('Cadangan terlalu besar (>100 MB).');let raw=JSON.parse(await file.text());let r=sanitizeImport(raw.record||raw);let old=await getRec(r.id);if(old&&!confirm('ID ruas ini sudah ada di perangkat. Timpa data lokal dengan cadangan?'))return;await saveRec(r);await openRecord(r.id);toast('Cadangan telah diimpor ke database lokal.')}
async function clone(){if(!current)return;await saveNow();let r=copyRecord(current);r.id=uid();r.revision=0;r.owner='';r.dirty=true;r.conflict=false;r.sample=false;r.updatedAt=stamp();r.photos=r.photos.map(p=>({...p,id:uid(),remoteUploaded:false}));await saveRec(r);await openRecord(r.id);toast('Salinan ruas baru dibuat. Periksa identitas sebelum sinkronisasi.')}
function bindEvents(){document.querySelector('#surveyForm').addEventListener('input',onFieldChange);document.querySelector('#surveyForm').addEventListener('change',onFieldChange);
$('surveyForm').addEventListener('click',e=>{const addTeam=e.target.closest('#addTeamBtn');if(addTeam){current.team ||= [];current.team.push({name:'',job:''});markDirty();renderTeam();return}
const rmTeam=e.target.closest('[data-remove-team]');if(rmTeam){current.team.splice(Number(rmTeam.dataset.removeTeam),1);markDirty();renderTeam();return}
const add=e.target.closest('#addSegBtn');if(add){current.segments.push({id:uid(),start:'',end:'',width:'',surface:'',condition:'',measurement:'',need:'',drainage:'',shoulder:'',defects:[],note:''});markDirty();renderSegments();return}const rmSeg=e.target.closest('[data-remove-seg]');if(rmSeg){if(!confirm('Hapus segmen dan foto terkait?'))return;current.segments=current.segments.filter(s=>s.id!==rmSeg.dataset.removeSeg);current.photos=current.photos.filter(p=>p.segmentId!==rmSeg.dataset.removeSeg);markDirty();renderSegments();renderPhotos();return}const rmPhoto=e.target.closest('[data-remove-photo]');if(rmPhoto){removePhoto(rmPhoto.dataset.removePhoto);return}const gps=e.target.closest('[data-gps-target]');if(gps){const el=document.querySelector(`[data-field="${gps.dataset.gpsTarget}"]`);geolocate(coord=>{el.value=coord;current.fields[gps.dataset.gpsTarget]=coord;markDirty();toast('Koordinat diambil dari GPS perangkat. Pastikan posisi benar.')});return}const pg=e.target.closest('[data-photo-gps]');if(pg){const p=current.photos.find(p=>p.id===pg.dataset.photoGps);if(p)geolocate(coord=>{p.coords=coord;markDirty();renderSegments();renderPhotos();toast('GPS foto tercatat.')})}});
$('surveyForm').addEventListener('change',async e=>{if(e.target.matches('[data-upload-role]')){const x=e.target;await acceptPhotos(Array.from(x.files||[]),x.dataset.uploadRole,x.dataset.segId);x.value=''}});
$('listBtn').addEventListener('click',async()=>{await saveNow();await renderList();showPage('list')});$('newBtn').addEventListener('click',newRecord);$('newFromList').addEventListener('click',newRecord);$('saveBtn').addEventListener('click',async()=>{await saveNow();toast('Data beserta foto tersimpan di database lokal HP.')});$('saveSide').addEventListener('click',async()=>{await saveNow();toast('Data tersimpan di perangkat.')});$('printBtn').addEventListener('click',async()=>{if(!current){toast('Buka ruas dulu.');return}await saveNow();if(!validateForPrint())return;buildReport();setTimeout(()=>window.print(),130)});$('backupBtn').addEventListener('click',async()=>{if(!current){toast('Buka ruas dulu.');return}await saveNow();downloadJSON(current)});$('importFile').addEventListener('change',async e=>{let file=e.target.files?.[0];if(!file)return;try{await importFile(file)}catch(err){notice('Gagal impor cadangan: '+err.message)}finally{e.target.value=''}});
$('recordsList').addEventListener('click',async e=>{const open=e.target.closest('[data-open-record]'),del=e.target.closest('[data-delete-record]'),backup=e.target.closest('[data-export-record]');if(open)return openRecord(open.dataset.openRecord);if(backup){let r=await getRec(backup.dataset.exportRecord);if(r)downloadJSON(r);return}if(del){let id=del.dataset.deleteRecord;if(confirm('Hapus salinan LOKAL ruas ini dari HP? Data yang pernah tersinkron di server tidak ikut terhapus.')){await deleteRec(id);if(current?.id===id)current=null;await renderList()}}});$('searchBox').addEventListener('input',renderList);$('filterStatus').addEventListener('change',renderList);$('cloneBtn').addEventListener('click',clone);$('downloadPhotosBtn').addEventListener('click',downloadPhotos);$('syncBtn').addEventListener('click',doSync);
$('accountBtn').addEventListener('click',()=>{$('apiUrl').value=apiBase;$('authModal').hidden=false});$('closeModal').addEventListener('click',()=>$('authModal').hidden=true);$('loginBtn').addEventListener('click',login);$('logoutBtn').addEventListener('click',logout);$('addUserBtn').addEventListener('click',createUser);window.addEventListener('online',onlineState);window.addEventListener('offline',onlineState);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveNow()});window.addEventListener('pagehide',()=>{if(current)saveRec(current).catch(()=>{})})}
async function init(){onlineState();authState();bindEvents();try{db=await openDatabase();await renderList();badge('saveBadge','Database lokal siap','good');if('serviceWorker' in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register('./sw.js').catch(err=>notice('Cache offline belum berhasil: '+err.message))}if(token&&apiBase&&navigator.onLine){api('/auth/me').then(r=>r.json()).then(d=>{account=d.user;authState()}).catch(()=>{})}if(location.protocol==='file:'){notice('Mode file:// tidak mendukung PWA secara konsisten. Unggah ke GitHub Pages (HTTPS), pasang ke layar utama saat online, lalu uji mode pesawat.')}else{notice('Siap offline setelah aplikasi pernah dibuka melalui HTTPS dan komponen PWA tersimpan.') }}catch(err){notice('Database lokal tidak dapat dibuka: '+err.message+'. Coba browser biasa, bukan mode privat.')}}
init();
