/* app.js — генератор с постоянными учителями для (класс, предмет)
   Поместите рядом с index.html и styles.css.
*/

const dayOrder = ["Понедельник","Вторник","Среда","Четверг","Пятница"];
const STORAGE_KEY = 'auto_schedule_v4';
const STORAGE_INPUTS = 'auto_schedule_inputs_v4';

// UI
const teachersEl = document.getElementById('teachers');
const classesEl = document.getElementById('classes');
const timesEl = document.getElementById('times');
const modeEl = document.getElementById('mode');
const generateBtn = document.getElementById('generate');
const loadSampleBtn = document.getElementById('loadSample');
const exportBtn = document.getElementById('export');
const importBtn = document.getElementById('import');
const clearBtn = document.getElementById('clear');
const tableBody = document.querySelector('#scheduleTable tbody');
const totalCount = document.getElementById('totalCount');

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function saveSchedule(arr){ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
function loadSchedule(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }catch(e){ return []; } }
function saveInputs(obj){ localStorage.setItem(STORAGE_INPUTS, JSON.stringify(obj)); }
function loadInputs(){ try{ return JSON.parse(localStorage.getItem(STORAGE_INPUTS)) || null; }catch(e){ return null; } }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function parseTeachers(text){
  return text.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const [name, subs] = line.split('|').map(p=>p && p.trim());
    const subjects = (subs||'').split(',').map(s=>s.trim()).filter(Boolean);
    return { id: uid(), name: name || 'Без имени', subjects };
  });
}
function parseClasses(text){
  return text.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const [name, subs] = line.split('|').map(p=>p && p.trim());
    const subjects = (subs||'').split(',').map(s=>s.trim()).filter(Boolean);
    return { id: uid(), name: name || 'Без класса', subjects };
  });
}
function parseTimes(text){
  return text.split(',').map(s=>s.trim()).filter(Boolean);
}

/* -------------------------
   Алгоритм назначения постоянных учителей
   (см. предыдущую версию — тот же подход с backtracking)
   ------------------------- */

function buildSubjectMap(teachers){
  const map = new Map();
  for(const t of teachers){
    for(const s of t.subjects){
      if(!map.has(s)) map.set(s, []);
      map.get(s).push(t);
    }
  }
  return map;
}

function countOccurrencesPerClass(cls, times, mode){
  const maxPerDay = {};
  if(mode === '6x4_7x1'){
    dayOrder.forEach((d,i)=> maxPerDay[d] = (i===4?7:6));
  } else {
    dayOrder.forEach((d,i)=> maxPerDay[d] = (i===4?6:7));
  }
  const maxPeriods = Math.min(7, times.length);
  let total = 0;
  for(const d of dayOrder) total += Math.min(maxPerDay[d], maxPeriods);
  const n = cls.subjects.length || 1;
  const base = Math.floor(total / n);
  const rem = total % n;
  const occ = {};
  for(let i=0;i<n;i++){
    occ[cls.subjects[i]] = base + (i < rem ? 1 : 0);
  }
  return occ;
}

function canAssignTeacherForPair(teacherId, clsName, subject, times, mode, currentBusy, clsSubjectsSchedule){
  const maxPerDay = {};
  if(mode === '6x4_7x1'){
    dayOrder.forEach((d,i)=> maxPerDay[d] = (i===4?7:6));
  } else {
    dayOrder.forEach((d,i)=> maxPerDay[d] = (i===4?6:7));
  }
  const maxPeriods = Math.min(7, times.length);

  for(const day of dayOrder){
    const periodsCount = Math.min(maxPerDay[day], maxPeriods);
    for(let p=0;p<periodsCount;p++){
      const subj = clsSubjectsSchedule[day] && clsSubjectsSchedule[day][p];
      if(subj === subject){
        const tBusy = currentBusy.get(teacherId) || new Map();
        const dayBusy = tBusy.get(day) || new Set();
        if(dayBusy.has(p+1)) return false;
      }
    }
  }
  return true;
}

function buildClassSubjectsSchedule(cls, times, mode){
  const schedule = {};
  const maxPerDay = {};
  if(mode === '6x4_7x1'){
    dayOrder.forEach((d,i)=> maxPerDay[d] = (i===4?7:6));
  } else {
    dayOrder.forEach((d,i)=> maxPerDay[d] = (i===4?6:7));
  }
  const maxPeriods = Math.min(7, times.length);
  let startIdx = Math.abs(hashString(cls.name)) % (cls.subjects.length || 1);
  for(const day of dayOrder){
    const periodsCount = Math.min(maxPerDay[day], maxPeriods);
    schedule[day] = [];
    for(let p=0;p<periodsCount;p++){
      schedule[day][p] = cls.subjects[(startIdx + p) % cls.subjects.length];
    }
    startIdx = (startIdx + 1) % (cls.subjects.length || 1);
  }
  return schedule;
}

function hashString(s){
  let h=0;
  for(let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  return h;
}

function assignTeachersForAll(teachers, classes, times, mode){
  const subjMap = buildSubjectMap(teachers);
  const classSchedules = {};
  for(const cls of classes){
    classSchedules[cls.name] = buildClassSubjectsSchedule(cls, times, mode);
  }

  const pairs = [];
  for(const cls of classes){
    const occ = countOccurrencesPerClass(cls, times, mode);
    for(const subj of cls.subjects){
      pairs.push({
        className: cls.name,
        subject: subj,
        occurrences: occ[subj] || 0
      });
    }
  }
  pairs.sort((a,b)=> b.occurrences - a.occurrences);

  const currentBusy = new Map();
  for(const t of teachers) currentBusy.set(t.id, new Map());

  const mapping = new Map();
  for(const cls of classes) mapping.set(cls.name, new Map());

  function getCandidates(subject){
    const list = subjMap.get(subject) || [];
    const arr = list.slice().sort((a,b)=>{
      const aBusy = Array.from(currentBusy.get(a.id).values()).reduce((s,st)=>s+st.size,0);
      const bBusy = Array.from(currentBusy.get(b.id).values()).reduce((s,st)=>s+st.size,0);
      return aBusy - bBusy;
    });
    return arr;
  }

  function backtrack(index){
    if(index >= pairs.length) return true;
    const pair = pairs[index];
    const clsName = pair.className;
    const subject = pair.subject;
    const candidates = getCandidates(subject);

    if(candidates.length === 0){
      mapping.get(clsName).set(subject, null);
      return backtrack(index+1);
    }

    for(const cand of candidates){
      const can = canAssignTeacherForPair(cand.id, clsName, subject, times, mode, currentBusy, classSchedules[clsName]);
      if(!can) continue;

      const tBusy = currentBusy.get(cand.id);
      for(const day of dayOrder){
        const periods = classSchedules[clsName][day] || [];
        for(let p=0;p<periods.length;p++){
          if(periods[p] === subject){
            const daySet = tBusy.get(day) || new Set();
            daySet.add(p+1);
            tBusy.set(day, daySet);
          }
        }
      }
      mapping.get(clsName).set(subject, cand);

      if(backtrack(index+1)) return true;

      for(const day of dayOrder){
        const periods = classSchedules[clsName][day] || [];
        for(let p=0;p<periods.length;p++){
          if(periods[p] === subject){
            const daySet = tBusy.get(day) || new Set();
            daySet.delete(p+1);
            if(daySet.size === 0) tBusy.delete(day);
            else tBusy.set(day, daySet);
          }
        }
      }
      mapping.get(clsName).delete(subject);
    }

    mapping.get(clsName).set(subject, null);
    return backtrack(index+1);
  }

  const ok = backtrack(0);
  return { mapping, classSchedules, subjMap, ok };
}

function buildFinalSchedule(mappingObj, classes, times, mode){
  const { mapping, classSchedules } = mappingObj;
  const out = [];

  for(const cls of classes){
    const clsName = cls.name;
    const schedule = classSchedules[clsName];
    for(const day of dayOrder){
      const periods = schedule[day] || [];
      for(let p=0;p<periods.length;p++){
        const subj = periods[p];
        const teacherObj = mapping.get(clsName).get(subj);
        const teacherName = teacherObj ? teacherObj.name : '— (нет доступного учителя)';
        const time = times[p] || times[times.length-1] || '';
        out.push({
          id: uid(),
          className: clsName,
          day,
          period: p+1,
          time,
          subject: subj,
          teacher: teacherName
        });
      }
    }
  }

  out.sort((a,b)=>{
    const da = dayOrder.indexOf(a.day), db = dayOrder.indexOf(b.day);
    if(da !== db) return da - db;
    if(a.className !== b.className) return a.className.localeCompare(b.className, undefined, {numeric:true});
    return a.period - b.period;
  });

  return out;
}

/* -------------------------
   UI: генерация, экспорт, импорт, рендер
   ------------------------- */

function render(schedule){
  tableBody.innerHTML = '';
  if(!schedule || schedule.length === 0){
    tableBody.innerHTML = `<tr><td colspan="8" class="hint">Пусто — сгенерируйте расписание</td></tr>`;
    totalCount.innerText = '0 записей';
    return;
  }
  let idx = 1;
  for(const r of schedule){
    const tr = document.createElement('tr');
    tr.className = 'row-' + r.day;
    tr.innerHTML = `
      <td>${idx++}</td>
      <td>${escapeHtml(r.className)}</td>
      <td>${r.day}</td>
      <td>${r.period}</td>
      <td>${escapeHtml(r.time)}</td>
      <td style="text-align:left">${escapeHtml(r.subject)}</td>
      <td style="text-align:left">${escapeHtml(r.teacher)}</td>
      <td><button class="action-btn" data-id="${r.id}">Удалить</button></td>
    `;
    tableBody.appendChild(tr);
  }
  totalCount.innerText = schedule.length + ' записей';
}

generateBtn.addEventListener('click', ()=>{
  try{
    const teachers = parseTeachers(teachersEl.value);
    const classes = parseClasses(classesEl.value);
    const times = parseTimes(timesEl.value);
    const mode = modeEl.value;

    if(teachers.length === 0) return alert('Введите список учителей.');
    if(classes.length === 0) return alert('Введите список классов.');
    if(times.length === 0) return alert('Введите времена уроков.');

    saveInputs({ teachersText: teachersEl.value, classesText: classesEl.value, timesText: timesEl.value, mode });

    const mappingObj = assignTeachersForAll(teachers, classes, times, mode);
    if(!mappingObj.ok){
      console.warn('Не удалось найти полное решение без конфликтов — некоторые слоты могут быть пустыми.');
      alert('Некоторые пары не удалось назначить без конфликтов — они помечены как "нет доступного учителя".');
    }

    const finalSchedule = buildFinalSchedule(mappingObj, classes, times, mode);
    saveSchedule(finalSchedule);
    render(finalSchedule);
    alert('Готово — расписание сгенерировано (постоянные учителя назначены).');
  }catch(e){
    console.error(e);
    alert('Ошибка генерации: ' + (e.message || e));
  }
});

tableBody.addEventListener('click', (ev)=>{
  const btn = ev.target.closest('button[data-id]');
  if(!btn) return;
  const id = btn.getAttribute('data-id');
  if(!confirm('Удалить запись?')) return;
  let schedule = loadSchedule();
  schedule = schedule.filter(s=>s.id !== id);
  saveSchedule(schedule);
  render(schedule);
});

exportBtn.addEventListener('click', ()=>{
  const schedule = loadSchedule();
  if(!schedule || schedule.length === 0) return alert('Нет данных для экспорта.');
  const data = JSON.stringify(schedule, null, 2);
  const w = window.open('', '_blank');
  w.document.write('<pre style="white-space:pre-wrap;">' + escapeHtml(data) + '</pre>');
  w.document.title = 'Экспорт расписания JSON';
});

importBtn.addEventListener('click', ()=>{
  const txt = prompt('Вставьте JSON расписания (заменит текущее):');
  if(!txt) return;
  try{
    const arr = JSON.parse(txt);
    if(!Array.isArray(arr)) throw new Error('Ожидается массив записей.');
    saveSchedule(arr);
    render(arr);
    alert('Импорт выполнен.');
  }catch(e){
    alert('Ошибка импорта: ' + e.message);
  }
});

clearBtn.addEventListener('click', ()=>{
  if(!confirm('Удалить всё расписание и входные данные?')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_INPUTS);
  teachersEl.value = '';
  classesEl.value = '';
  timesEl.value = '';
  modeEl.value = '6x4_7x1';
  render([]);
});

loadSampleBtn.addEventListener('click', ()=>{
  // Пример: 30 учителей (повторяющиеся предметы, у каждого предмета примерно по 2 учителя)
  const subjects = [
    'Математика','Физика','Русский язык','Литература','Английский',
    'История','Биология','Химия','География','Информатика',
    'Физкультура','Музыка','ИЗО','Обществознание','Технология'
  ];

  // Создаём 30 учителей, у каждого 1-2 предмета (повторы допустимы)
  const teachers = [];
  for(let i=0;i<30;i++){
    const n = i+1;
    // даём каждому 2 предмета: subjects[i % len] и subjects[(i+3) % len] — чтобы предметы повторялись и были дубли
    const s1 = subjects[i % subjects.length];
    const s2 = subjects[(i + 3) % subjects.length];
    teachers.push(`Учитель ${n}|${s1},${s2}`);
  }
  teachersEl.value = teachers.join('\n');

  // Классы: 10-х — 5 штук (10A..10E), 11-х — 5 штук, 12-х — 5 штук (всего 15 классов)
  const classes = [];
  for(let i=0;i<5;i++){
    const name = `10${String.fromCharCode(65+i)}`; // 10A..10E
    classes.push(`${name}|Математика,Русский язык,Английский,История,Физика,Биология`);
  }
  for(let i=0;i<5;i++){
    const name = `11${String.fromCharCode(65+i)}`; // 11A..11E
    classes.push(`${name}|Математика,Русский язык,Английский,Химия,География,Информатика`);
  }
  for(let i=0;i<5;i++){
    const name = `12${String.fromCharCode(65+i)}`; // 12A..12E
    classes.push(`${name}|Математика,Литература,Английский,Обществознание,Физкультура,Технология`);
  }
  classesEl.value = classes.join('\n');

  timesEl.value = '08:30,09:20,10:10,11:00,11:50,12:40,13:30';
  modeEl.value = '6x4_7x1';
  saveInputs({ teachersText: teachersEl.value, classesText: classesEl.value, timesText: timesEl.value, mode: modeEl.value });
  alert('Пример (30 учителей, 15 классов) загружен. Нажмите "Сгенерировать".');
});

// загрузка при старте
(function init(){
  const savedInputs = loadInputs();
  if(savedInputs){
    teachersEl.value = savedInputs.teachersText || teachersEl.value;
    classesEl.value = savedInputs.classesText || classesEl.value;
    timesEl.value = savedInputs.timesText || timesEl.value;
    modeEl.value = savedInputs.mode || modeEl.value;
  }
  const savedSchedule = loadSchedule();
  render(savedSchedule);
})();
