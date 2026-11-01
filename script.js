(() => {
  'use strict';

  const STORAGE_KEY = 'move-plus:data:v1';
  const OLD_SET_KEY = 'workout-daily-sets-v2';
  const OLD_WELLNESS_KEY = 'workout-wellness-v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const main = $('#main-content');
  const dialog = $('#menu-dialog');
  const form = $('#menu-form');
  const toastNode = $('#toast');

  const starterMenus = [
    ['座りスクワット', 15, 3], ['腿上げ左右', 15, 3], ['踵上げ', 50, 3],
    ['ブラジリアンスクワット', 20, 3], ['足上げ腹筋', 20, 3], ['仰向けお尻上げ', 15, 3], ['膝立腕立て', 5, 3],
  ];
  const moodChoices = [
    { value: 1, face: '☁️', label: 'しんどい' }, { value: 2, face: '🌧️', label: 'いまひとつ' },
    { value: 3, face: '🌤️', label: 'ふつう' }, { value: 4, face: '☀️', label: 'いい感じ' }, { value: 5, face: '✨', label: '最高' },
  ];
  const dateToday = localDate(new Date());
  const state = {
    view: 'today', date: dateToday, reviewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    reviewDate: dateToday, trendRange: 30, trendMetric: 'weight', toastTimer: null, saveTimer: null,
  };

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function dateFromKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  function id() { return globalThis.crypto?.randomUUID?.() || `mp-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function clampInt(value, min, max) { return Math.min(max, Math.max(min, Math.round(Number(value) || 0))); }
  function freshMenus() { return []; }
  function legacyMenus() { return starterMenus.map(([name, reps, targetSets]) => ({ id: id(), name, reps, targetSets, active: true })); }
  function normalizeExercise(item) {
    return {
      id: String(item.id || item.templateId || id()),
      name: String(item.name || '運動メニュー').slice(0, 50),
      reps: clampInt(item.reps, 1, 999) || 1,
      targetSets: clampInt(item.targetSets ?? item.setsTarget, 1, 30) || 1,
      sets: clampInt(item.sets ?? item.completedSets, 0, 30),
    };
  }
  function normalizeRecord(record, menus = []) {
    const items = Array.isArray(record.exercises) ? record.exercises : (Array.isArray(record.items) ? record.items : []);
    return {
      exercises: items.map(normalizeExercise),
      condition: record.condition == null || record.condition === '' ? null : clampInt(record.condition, 1, 5),
      weight: record.weight == null || record.weight === '' ? '' : String(record.weight),
      sleep: record.sleep == null || record.sleep === '' ? '' : String(record.sleep),
      note: String(record.note || '').slice(0, 1000),
      updatedAt: record.updatedAt || null,
    };
  }
  function emptyRecord(menus = data.menus) {
    return { exercises: menus.filter(menu => menu.active !== false).map(menu => ({ id: menu.id, name: menu.name, reps: menu.reps, targetSets: menu.targetSets, sets: 0 })), condition: null, weight: '', sleep: '', note: '', updatedAt: null };
  }
  function normalizeData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const menus = Array.isArray(raw.menus) ? raw.menus.map(menu => ({
      id: String(menu.id || id()), name: String(menu.name || '運動メニュー').slice(0, 50),
      reps: clampInt(menu.reps, 1, 999) || 1, targetSets: clampInt(menu.targetSets, 1, 30) || 1,
      active: menu.active !== false,
    })) : freshMenus();
    const records = {};
    if (raw.records && typeof raw.records === 'object' && !Array.isArray(raw.records)) {
      for (const [date, record] of Object.entries(raw.records)) if (/^\d{4}-\d{2}-\d{2}$/.test(date) && record && typeof record === 'object') records[date] = normalizeRecord(record);
    }
    return { schemaVersion: 1, menus, records, preferences: { theme: raw.preferences?.theme === 'dark' ? 'dark' : 'light' } };
  }
  function migrateLegacy() {
    const oldSets = readJson(OLD_SET_KEY);
    const oldWellness = readJson(OLD_WELLNESS_KEY);
    if (!oldSets && !oldWellness) return null;
    const menus = legacyMenus();
    const records = {};
    if (oldSets && typeof oldSets === 'object') {
      for (const [date, setsByName] of Object.entries(oldSets)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !setsByName || typeof setsByName !== 'object') continue;
        const record = emptyRecord(menus);
        record.exercises = menus.map(menu => ({ ...menuSnapshot(menu), sets: clampInt(setsByName[menu.name], 0, 30) }));
        records[date] = record;
      }
    }
    if (oldWellness && typeof oldWellness === 'object') {
      for (const [date, previous] of Object.entries(oldWellness)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !previous || typeof previous !== 'object') continue;
        const record = records[date] || emptyRecord(menus);
        record.condition = previous.condition == null ? null : clampInt(previous.condition, 1, 5);
        record.sleep = previous.sleep == null ? '' : String(previous.sleep);
        records[date] = record;
      }
    }
    return { schemaVersion: 1, menus, records, preferences: { theme: 'light' } };
  }
  function readJson(key) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : null; } catch { return null; }
  }
  const data = normalizeData(readJson(STORAGE_KEY)) || migrateLegacy() || {
    schemaVersion: 1, menus: freshMenus(), records: {}, preferences: { theme: 'light' },
  };
  let storageAvailable = true;

  function menuSnapshot(menu) { return { id: menu.id, name: menu.name, reps: menu.reps, targetSets: menu.targetSets, sets: 0 }; }
  function saveData(silent = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageAvailable = true;
      if (state.view === 'today') setSaveState('端末内に保存しました');
      return true;
    } catch (error) {
      storageAvailable = false;
      if (state.view === 'today') setSaveState('保存できませんでした。空き容量をご確認ください', true);
      if (!silent) showToast('端末に保存できませんでした', true);
      return false;
    }
  }
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveData(), 180);
  }
  function setSaveState(message, isError = false) {
    const node = $('#save-state');
    if (node) {
      node.replaceChildren(document.createTextNode(message)); node.classList.toggle('is-error', isError);
      if (isError) { const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button'; retry.dataset.action = 'retry-save'; retry.textContent = '再試行'; node.append(' ', retry); }
    }
  }
  function recordFor(date, create = false) {
    if (!data.records[date] && create) data.records[date] = emptyRecord();
    return data.records[date] || null;
  }
  function ensureRecord(date) {
    if (!data.records[date]) data.records[date] = emptyRecord();
    data.records[date].updatedAt = new Date().toISOString();
    return data.records[date];
  }
  function exerciseItems(date) {
    const record = recordFor(date);
    if (record) {
      if (date === dateToday) {
        const known = new Set(record.exercises.map(item => item.id));
        const newlyAddedMenus = data.menus.filter(menu => menu.active && !known.has(menu.id)).map(menuSnapshot);
        if (newlyAddedMenus.length) { record.exercises.push(...newlyAddedMenus); scheduleSave(); }
      }
      return record.exercises;
    }
    return data.menus.filter(menu => menu.active).map(menuSnapshot);
  }
  function hasWorkout(record) { return Boolean(record?.exercises?.some(item => item.sets > 0)); }
  function hasWellness(record) { return Boolean(record && (record.condition || record.weight || record.sleep || record.note.trim())); }
  function hasAnyRecord(record) { return hasWorkout(record) || hasWellness(record); }
  function formatDate(key, options = { month: 'long', day: 'numeric', weekday: 'long' }) {
    return new Intl.DateTimeFormat('ja-JP', options).format(dateFromKey(key));
  }
  function menuCountText(record) {
    const count = record?.exercises?.filter(item => item.sets > 0).length || 0;
    if (!count) return 'まだ運動を記録していません';
    return `${count}種目 ・ ${record.exercises.reduce((sum, item) => sum + item.sets, 0)}セット`;
  }
  function getStreak(anchor = dateToday) {
    let cursor = dateFromKey(anchor);
    if (!hasWorkout(recordFor(localDate(cursor))) && localDate(cursor) === dateToday) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (count < 3650 && hasWorkout(recordFor(localDate(cursor)))) { count++; cursor.setDate(cursor.getDate() - 1); }
    return count;
  }
  function weekActivity(anchor) {
    const end = dateFromKey(anchor); const mondayOffset = (end.getDay() + 6) % 7;
    end.setDate(end.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(end); day.setDate(end.getDate() + index); const key = localDate(day);
      return { key, day, record: recordFor(key) };
    });
  }
  function showToast(message, error = false) {
    toastNode.textContent = message; toastNode.classList.toggle('is-error', error); toastNode.classList.add('is-visible');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => toastNode.classList.remove('is-visible'), 2800);
  }

  function render() {
    $('#mobile-date').textContent = formatDate(dateToday, { month: 'short', day: 'numeric', weekday: 'short' });
    $$('.nav-item[data-view], .mobile-nav-item[data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    const views = { today: renderToday, review: renderReview, menus: renderMenus, settings: renderSettings };
    main.innerHTML = `<div class="screen-enter">${views[state.view]()}</div>`;
  }

  function renderToday() {
    const record = recordFor(state.date);
    const isToday = state.date === dateToday;
    const countSets = record?.exercises.reduce((sum, item) => sum + item.sets, 0) || 0;
    const activeDays = weekActivity(state.date).filter(day => hasWorkout(day.record)).length;
    const streak = getStreak(state.date);
    const items = exerciseItems(state.date);
    const workoutList = items.length ? items.map((item, index) => {
      const ratio = Math.min(100, item.targetSets ? item.sets / item.targetSets * 100 : 0);
      const done = item.sets > 0;
      return `<article class="workout-row${done ? ' is-logged' : ''}">
        <div class="workout-info"><div class="workout-title-line"><i class="workout-mark" aria-hidden="true"></i><h3 class="workout-name">${escapeHtml(item.name)}</h3></div>
          <p class="workout-target">${item.reps}回 × ${item.targetSets}セット目安</p>
          <div class="workout-meter" aria-label="${item.sets}セット記録、目標${item.targetSets}セット"><div class="set-track"><span style="width:${ratio}%"></span></div><span class="set-label">${item.sets} / ${item.targetSets} セット</span></div>
          ${item.sets > 0 ? `<button class="text-button remove-set-record" type="button" data-action="delete-day-exercise" data-id="${escapeHtml(item.id)}">この日の実績を削除</button>` : ''}
        </div>
        <div class="workout-actions" aria-label="${escapeHtml(item.name)}のセット数">
          <button class="step-button" type="button" data-action="change-set" data-id="${escapeHtml(item.id)}" data-delta="-1" aria-label="${escapeHtml(item.name)}のセットを減らす" ${item.sets <= 0 ? 'disabled' : ''}>−</button>
          <button class="step-button step-plus" type="button" data-action="change-set" data-id="${escapeHtml(item.id)}" data-delta="1" aria-label="${escapeHtml(item.name)}のセットを記録">＋</button>
          ${item.sets < item.targetSets ? `<button class="target-button" type="button" data-action="complete-target" data-id="${escapeHtml(item.id)}">目標まで</button>` : ''}
        </div>
      </article>`;
    }).join('') : `<div class="empty-state"><strong>まずはメニューをつくりましょう</strong><p>いつもの運動を登録すると、次からはタップで記録できます。</p><button class="button button-primary" type="button" data-view="menus">メニューを登録</button></div>`;
    const week = weekActivity(state.date).map(day => `<div class="week-day${hasWorkout(day.record) ? ' is-workout' : ''}${day.key === state.date ? ' is-selected' : ''}" aria-label="${formatDate(day.key, { month: 'long', day: 'numeric', weekday: 'long' })}${hasWorkout(day.record) ? ' 運動記録あり' : ''}"><span>${'月火水木金土日'[day.day.getDay() === 0 ? 6 : day.day.getDay() - 1]}</span><i></i></div>`).join('');
    const mood = record?.condition || '';
    return `
      <header class="page-heading">
        <div><p class="eyebrow">YOUR DAILY RHYTHM</p><h1>${isToday ? '今日の' : `<em>${formatDate(state.date, { month: 'long', day: 'numeric' })}</em>の`}記録</h1><p class="page-subtitle">できたことを、できた分だけ。あなたのペースで続けましょう。</p></div>
        <div class="date-switcher"><button type="button" data-action="date-shift" data-delta="-1" aria-label="前の日">‹</button><input id="selected-date" type="date" value="${state.date}" aria-label="記録する日付"><button type="button" data-action="date-shift" data-delta="1" aria-label="次の日" ${state.date >= dateToday ? 'disabled' : ''}>›</button></div>
      </header>
      <section class="daily-hero" aria-label="運動習慣のサマリー">
        <div class="hero-copy"><p class="hero-kicker">${isToday ? 'A LITTLE MOVEMENT, A BETTER DAY' : 'YOUR PERSONAL LOG'}</p><h2 class="hero-title">${hasWorkout(record) ? '今日の自分に、<span>ひとつプラス。</span>' : '小さく動いて、<span>自分を整える。</span>'}</h2><p class="hero-caption">${hasWorkout(record) ? '記録できました。その積み重ねが、あなたのリズムです。' : '休む日も大切な選択。記録はいつでも、思い出したときに。'}</p></div>
        <div class="hero-art" aria-hidden="true"><div class="hero-orbit"><div class="hero-orbit-inner"></div></div><div class="hero-core"><svg viewBox="0 0 48 48"><path d="M7 28c6.5 0 7.5-13 14-13s7.5 13 14 13M13 34c5.5 0 6.5-8 12-8s6.5 8 12 8"/></svg></div></div>
      </section>
      <section class="week-strip" aria-label="今週の運動状況"><div class="week-intro"><strong>今週のリズム</strong><span>${streak ? `現在 ${streak} 日連続で記録中` : '動けた日を、少しずつ'}</span></div><div class="week-days">${week}</div><div class="week-total"><strong>${activeDays}<small> / 7</small></strong><span>運動した日</span></div></section>
      <div class="daily-grid">
        <section class="panel panel-pad workout-panel"><div class="panel-head"><div><p class="eyebrow">MOVEMENT</p><h2>今日の運動</h2><p>${escapeHtml(menuCountText(record))}</p></div><span class="panel-index">01</span></div>
          <div class="workout-list">${workoutList}</div>
          <div class="workout-toolbar"><span>タップでセットを記録</span><button class="add-exercise" type="button" data-view="menus"><b>＋</b> メニューを編集</button></div>
        </section>
        <section class="panel wellness-panel"><div class="wellness-top"><div class="panel-head"><div><p class="eyebrow">HOW ARE YOU?</p><h2>今日のコンディション</h2><p>気分も体の声も、気軽に残してみましょう。</p></div><span class="panel-index">02</span></div>
          <div class="mood-options" role="radiogroup" aria-label="今日の気分">${moodChoices.map(choice => `<label class="mood-option"><input type="radio" name="condition" value="${choice.value}" ${Number(mood) === choice.value ? 'checked' : ''}><span class="mood-face"><b>${choice.face}</b><small>${choice.label}</small></span></label>`).join('')}</div></div>
          <div class="wellness-fields">
            <label><span class="field-label">体重 <span>任意</span></span><span class="number-field"><input class="field-input" data-field="weight" type="number" min="20" max="300" step="0.1" inputmode="decimal" placeholder="記録しない日もOK" value="${escapeHtml(record?.weight || '')}" aria-label="体重"><span>kg</span></span></label>
            <label><span class="field-label">睡眠時間 <span>任意</span></span><span class="number-field"><input class="field-input" data-field="sleep" type="number" min="0" max="24" step="0.1" inputmode="decimal" placeholder="例：7.5" value="${escapeHtml(record?.sleep || '')}" aria-label="睡眠時間"><span>時間</span></span></label>
            <label><span class="field-label">ひとことメモ <span>気づいたことを自由に</span></span><textarea class="field-textarea" data-field="note" maxlength="1000" placeholder="体の調子、気分、今日の小さな発見…" aria-label="体調や気分のメモ">${escapeHtml(record?.note || '')}</textarea></label>
            <p id="save-state" class="save-state${storageAvailable ? '' : ' is-error'}" role="status">${storageAvailable ? '入力内容は自動で保存されます' : '端末内への保存に失敗しました'}${storageAvailable ? '' : ' '} ${storageAvailable ? '' : '<button class="text-button" type="button" data-action="retry-save">再試行</button>'}</p>
          </div>
        </section>
      </div>`;
  }

  function renderReview() {
    const monthDate = state.reviewMonth; const year = monthDate.getFullYear(); const month = monthDate.getMonth();
    const monthLabel = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' }).format(monthDate);
    const first = new Date(year, month, 1); const startOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startOffset);
    const selectedRecord = recordFor(state.reviewDate);
    const workoutDays = Object.entries(data.records).filter(([, record]) => hasWorkout(record)).length;
    const windowDays = trendDates(state.trendRange);
    const workoutCount = windowDays.filter(key => hasWorkout(recordFor(key))).length;
    const chartField = state.trendMetric === 'sleep' ? 'sleep' : 'weight';
    const chartValues = windowDays.map(key => ({ key, value: recordedNumber(key, chartField) })).filter(item => item.value != null && Number.isFinite(item.value) && (chartField === 'sleep' ? item.value >= 0 : item.value > 0));
    const latestValue = chartValues.at(-1)?.value;
    const firstValue = chartValues[0]?.value;
    const chartUnit = chartField === 'sleep' ? '時間' : 'kg';
    const trendText = state.trendMetric === 'activity'
      ? `${workoutCount}<small> 日</small>`
      : latestValue == null ? '—' : `${latestValue.toFixed(1)}<small> ${chartUnit}</small>`;
    const change = latestValue == null || firstValue == null || chartValues.length < 2 ? null : latestValue - firstValue;
    const changeText = state.trendMetric === 'activity'
      ? '運動を記録した日数'
      : change == null ? '記録が増えると表示されます' : `${change > 0 ? '+' : ''}${change.toFixed(1)} ${chartUnit}`;
    const metricTitle = { weight: '体重の推移', sleep: '睡眠時間の推移', activity: '運動頻度' }[state.trendMetric];
    const chartMarkup = state.trendMetric === 'activity'
      ? renderActivityChart(windowDays)
      : renderNumericChart(windowDays, chartField, chartUnit);
    const calendarCells = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); const key = localDate(date); const rec = recordFor(key);
      const classes = ['calendar-day']; if (date.getMonth() !== month) classes.push('is-other-month'); if (hasWorkout(rec)) classes.push('is-workout'); else if (hasWellness(rec)) classes.push('is-wellness'); if (key === dateToday) classes.push('is-today'); if (key === state.reviewDate) classes.push('is-selected');
      return `<button class="${classes.join(' ')}" type="button" data-action="select-review-date" data-date="${key}" aria-label="${formatDate(key, { month: 'long', day: 'numeric', weekday: 'long' })}${hasWorkout(rec) ? ' 運動記録あり' : hasWellness(rec) ? ' 体調記録あり' : ''}" aria-pressed="${key === state.reviewDate}" ${key > dateToday ? 'disabled' : ''}>${date.getDate()}${hasAnyRecord(rec) ? '<i class="calendar-mark" aria-hidden="true"></i>' : ''}</button>`;
    }).join('');
    const weekday = '月火水木金土日'.split('').map(day => `<span class="calendar-weekday">${day}</span>`).join('');
    const selectedSummary = hasAnyRecord(selectedRecord) ? renderRecordSummary(selectedRecord, state.reviewDate) : `<div class="empty-state"><strong>この日の記録はありません</strong><p>あとからでも記録を追加できます。</p><button class="button button-quiet" type="button" data-action="open-date" data-date="${state.reviewDate}">この日を記録する</button></div>`;
    return `<header class="page-heading"><div><p class="eyebrow">LOOK BACK, MOVE FORWARD</p><h1>歩みを、<em>見つめる。</em></h1><p class="page-subtitle">続けた日も、休んだ日も。これまでの自分を確かめる時間。</p></div><div class="review-tabs" role="group" aria-label="グラフの期間">${[[7, '7日'], [30, '30日'], [90, '90日']].map(([n, label]) => `<button class="review-tab" type="button" data-action="trend-range" data-range="${n}" aria-pressed="${state.trendRange === n}">${label}</button>`).join('')}</div></header>
      <section class="panel chart-panel"><div class="chart-heading"><div><p class="eyebrow">BODY & MOVEMENT</p><h2>${metricTitle}</h2><p>直近${state.trendRange}日間の記録</p></div><div class="chart-value"><strong>${trendText}</strong><span>${changeText}</span></div></div><div class="trend-toolbar chart-metric-toolbar"><div class="metric-tabs" role="group" aria-label="表示するグラフ">${[['activity', '運動頻度'], ['weight', '体重'], ['sleep', '睡眠']].map(([key, label]) => `<button class="metric-tab" type="button" data-action="trend-metric" data-metric="${key}" aria-pressed="${state.trendMetric === key}">${label}</button>`).join('')}</div></div><div class="chart-container">${chartMarkup}</div><p class="chart-footnote">${chartValues.length < 2 && state.trendMetric !== 'activity' ? `${state.trendMetric === 'sleep' ? '睡眠時間' : '体重'}を2日以上記録すると、推移がここに表示されます。記録のない日は空白のままです。` : 'グラフの日付点を選ぶと、その日の記録を確認できます。運動の休みや未記録を失敗として扱いません。'}</p><div class="trend-lower"><section class="panel"><h3>この期間のまとめ</h3><div class="trend-fact"><span>運動した日</span><strong>${workoutCount}日 / ${state.trendRange}日</strong></div><div class="trend-fact"><span>記録した日</span><strong>${windowDays.filter(key => hasAnyRecord(recordFor(key))).length}日</strong></div></section><section class="panel"><h3>あなたのペース</h3><div class="trend-fact"><span>これまでの運動記録</span><strong>${workoutDays}日</strong></div><div class="trend-fact"><span>連続記録</span><strong>${getStreak(dateToday)}日</strong></div></section></div></section>
      <div class="review-layout"><section class="panel review-calendar-panel"><div class="panel-head"><div><p class="eyebrow">YOUR CALENDAR</p><h2>続けた日を見つける</h2></div><div class="month-switcher"><button type="button" data-action="month-shift" data-delta="-1" aria-label="前の月">‹</button><h2>${monthLabel}</h2><button type="button" data-action="month-shift" data-delta="1" aria-label="次の月" ${year === new Date().getFullYear() && month === new Date().getMonth() ? 'disabled' : ''}>›</button></div></div><div class="calendar-grid">${weekday}${calendarCells}</div><div class="calendar-legend"><span class="legend-item"><i class="legend-dot"></i>運動を記録した日</span><span class="legend-item"><i class="legend-dot wellness"></i>体調を記録した日</span></div></section>
        <section class="panel selected-day-panel" id="selected-day-panel"><p class="eyebrow">DAY DETAIL</p><h3>${formatDate(state.reviewDate)}</h3><p>${hasAnyRecord(selectedRecord) ? 'その日の記録' : '記録を選ぶと詳細が表示されます'}</p>${selectedSummary}</section></div>
      <section class="history-section"><div class="panel-head"><div><p class="eyebrow">RECENT NOTES</p><h2>最近の記録</h2></div></div><div class="history-list">${renderHistory(windowDays)}</div></section>`;
  }

  function renderRecordSummary(record, date) {
    const exercises = record.exercises.filter(item => item.sets > 0);
    const condition = moodChoices.find(choice => choice.value === Number(record.condition));
    return `<div class="selected-day-stats"><div class="mini-stat"><span>運動</span><strong>${exercises.length ? `${exercises.length}種目` : '—'}</strong></div><div class="mini-stat"><span>セット</span><strong>${exercises.reduce((sum, item) => sum + item.sets, 0) || '—'}</strong></div>${record.weight !== '' ? `<div class="mini-stat"><span>体重</span><strong>${escapeHtml(record.weight)}<small> kg</small></strong></div>` : ''}${record.sleep !== '' ? `<div class="mini-stat"><span>睡眠</span><strong>${escapeHtml(record.sleep)}<small> h</small></strong></div>` : ''}</div><div class="selected-records">${condition ? `<p><span>気分</span><strong>${condition.face} ${condition.label}</strong></p>` : ''}${exercises.map(item => `<p><span>${escapeHtml(item.name)}</span><strong>${item.reps}回 × ${item.sets}セット</strong></p>`).join('')}${record.note ? `<blockquote>${escapeHtml(record.note)}</blockquote>` : ''}${!hasAnyRecord(record) ? '<p>この日に運動や体調を記録すると、ここに表示されます。</p>' : ''}<button class="text-button" type="button" data-action="open-date" data-date="${date}">この日の記録を編集 →</button></div>`;
  }

  function trendDates(days) {
    const result = []; const end = dateFromKey(dateToday);
    for (let i = days - 1; i >= 0; i--) { const date = new Date(end); date.setDate(end.getDate() - i); result.push(localDate(date)); }
    return result;
  }
  function recordedNumber(date, field) {
    const raw = recordFor(date)?.[field];
    return raw == null || raw === '' ? null : Number(raw);
  }
  function renderNumericChart(dates, field, unit) {
    const values = dates.map((key, index) => ({ key, index, value: recordedNumber(key, field) }))
      .filter(point => point.value != null && Number.isFinite(point.value) && (field === 'sleep' ? point.value >= 0 : point.value > 0));
    const subject = field === 'sleep' ? '睡眠時間' : '体重';
    if (!values.length) return `<div class="chart-empty"><span>＋</span><strong>最初の記録を残しましょう</strong><p>${subject}を入力すると、変化の流れが見えるようになります。</p></div>`;
    const W = 720, H = 220, left = 46, right = 16, top = 16, bottom = 34;
    const minRaw = Math.min(...values.map(point => point.value)); const maxRaw = Math.max(...values.map(point => point.value));
    const spread = Math.max(field === 'sleep' ? 2 : 1, maxRaw - minRaw);
    const min = field === 'sleep' ? 0 : Math.max(0, minRaw - spread * .2);
    const max = field === 'sleep' ? Math.max(8, Math.ceil(maxRaw)) : maxRaw + spread * .2;
    const x = index => left + (dates.length <= 1 ? .5 : index / (dates.length - 1)) * (W - left - right);
    const y = value => top + (1 - (value - min) / (max - min)) * (H - top - bottom);
    const ticks = [max, (max + min) / 2, min].map(value => `<g><line class="grid-line" x1="${left}" y1="${y(value)}" x2="${W - right}" y2="${y(value)}"/><text class="axis-text" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${value.toFixed(1)}</text></g>`).join('');
    const labels = [0, Math.floor((dates.length - 1) / 2), dates.length - 1].map(index => { const date = dateFromKey(dates[index]); return `<text class="axis-text" x="${x(index)}" y="${H - 8}" text-anchor="middle">${date.getMonth() + 1}/${date.getDate()}</text>`; }).join('');
    const segments = []; let segment = [];
    values.forEach(point => {
      if (segment.length && point.index !== segment.at(-1).index + 1) { segments.push(segment); segment = []; }
      segment.push(point);
    });
    if (segment.length) segments.push(segment);
    const lines = segments.filter(points => points.length > 1).map(points => `<polyline class="trend-line" points="${points.map(point => `${x(point.index)},${y(point.value)}`).join(' ')}"/>`).join('');
    const points = values.map(point => `<g class="chart-point" tabindex="0" role="button" data-action="chart-date" data-date="${point.key}" aria-label="${formatDate(point.key, { month: 'long', day: 'numeric' })}の${subject} ${point.value}${unit}"><circle class="trend-hit" cx="${x(point.index)}" cy="${y(point.value)}" r="16"/><circle class="trend-point" cx="${x(point.index)}" cy="${y(point.value)}" r="4" aria-hidden="true"/><title>${formatDate(point.key, { month: 'long', day: 'numeric' })}: ${point.value} ${unit}</title></g>`).join('');
    return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="直近${dates.length}日間の${subject}。${values.length}件の記録。日付の点を選ぶと記録を確認できます。">${ticks}${lines}${points}${labels}</svg>`;
  }
  function renderActivityChart(dates) {
    const weeks = [];
    for (let i = 0; i < dates.length; i += 7) {
      const group = dates.slice(i, i + 7); const active = group.filter(key => hasWorkout(recordFor(key)));
      weeks.push({ key: group[0], detailDate: active.at(-1) || group.at(-1), count: active.length });
    }
    const W = 720, H = 220, left = 32, right = 12, top = 16, bottom = 34; const slot = (W - left - right) / weeks.length; const max = Math.max(4, ...weeks.map(week => week.count));
    const grid = [0, 2, 4].map(tick => { const y = top + (1 - tick / max) * (H - top - bottom); return `<g><line class="grid-line" x1="${left}" y1="${y}" x2="${W - right}" y2="${y}"/><text class="axis-text" x="${left - 8}" y="${y + 4}" text-anchor="end">${tick}</text></g>`; }).join('');
    const bars = weeks.map((week, i) => { const height = week.count / max * (H - top - bottom); const x = left + i * slot + slot * .2; const width = slot * .6; const y = H - bottom - height; const date = dateFromKey(week.key); const pointDate = dateFromKey(week.detailDate); return `<g><rect class="trend-bar${week.count ? '' : ' is-empty'}" x="${x}" y="${week.count ? y : H - bottom - 4}" width="${width}" height="${week.count ? height : 4}" rx="5" tabindex="0" role="button" data-action="chart-date" data-date="${week.detailDate}" aria-label="${date.getMonth() + 1}月${date.getDate()}日からの7日間、運動${week.count}日。選ぶと${pointDate.getMonth() + 1}月${pointDate.getDate()}日の記録を表示"><title>${date.getMonth() + 1}/${date.getDate()}の週: ${week.count}日</title></rect>${i % Math.ceil(weeks.length / 5) === 0 || i === weeks.length - 1 ? `<text class="axis-text" x="${x + width / 2}" y="${H - 8}" text-anchor="middle">${date.getMonth() + 1}/${date.getDate()}</text>` : ''}</g>`; }).join('');
    return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="直近${dates.length}日間の週ごとの運動日数。棒を選ぶと該当期間の記録を確認できます。"><text class="axis-text" x="8" y="${top + 5}">日</text>${grid}${bars}</svg>`;
  }
  function renderHistory(dates) {
    const recorded = dates.filter(key => hasAnyRecord(recordFor(key))).reverse().slice(0, 5);
    if (!recorded.length) return '<div class="empty-state"><strong>まだ記録がありません</strong><p>記録を重ねると、ここから振り返れます。</p></div>';
    return recorded.map(key => {
      const record = recordFor(key); const names = record.exercises.filter(item => item.sets > 0).map(item => escapeHtml(item.name)); const tags = [];
      if (hasWorkout(record)) tags.push(`<span class="history-tag is-workout">${record.exercises.reduce((sum, item) => sum + item.sets, 0)}セット</span>`);
      if (record.condition) tags.push(`<span class="history-tag is-wellness">気分 ${record.condition}/5</span>`);
      if (record.weight) tags.push(`<span class="history-tag">${escapeHtml(record.weight)} kg</span>`);
      if (record.sleep !== '') tags.push(`<span class="history-tag">睡眠 ${escapeHtml(record.sleep)}h</span>`);
      return `<button class="history-entry" type="button" data-action="select-review-date" data-date="${key}"><span class="history-date"><strong>${formatDate(key, { month: 'short', day: 'numeric', weekday: 'short' })}</strong><span>${record.note ? 'メモあり' : record.sleep ? `睡眠 ${escapeHtml(record.sleep)}h` : '記録'}</span></span><span class="history-summary"><strong>${names.length ? names.join('、') : '体調の記録'}</strong>${escapeHtml((record.note || '').slice(0, 42))}</span><span class="history-tags">${tags.join('')}</span></button>`;
    }).join('');
  }

  function renderMenus() {
    const menus = data.menus.filter(menu => menu.active);
    const list = menus.length ? menus.map((menu, index) => `<article class="menu-card"><span class="menu-index">${String(index + 1).padStart(2, '0')}</span><div><h3 class="menu-name">${escapeHtml(menu.name)}</h3><p class="menu-target">${menu.reps}回 × ${menu.targetSets}セット</p><div class="menu-order-buttons"><button class="icon-button menu-order-button" type="button" data-action="move-menu" data-id="${escapeHtml(menu.id)}" data-delta="-1" aria-label="${escapeHtml(menu.name)}を上へ移動" ${index === 0 ? 'disabled' : ''}>↑ 上へ</button><button class="icon-button menu-order-button" type="button" data-action="move-menu" data-id="${escapeHtml(menu.id)}" data-delta="1" aria-label="${escapeHtml(menu.name)}を下へ移動" ${index === menus.length - 1 ? 'disabled' : ''}>↓ 下へ</button></div></div><div class="menu-actions"><button class="icon-button" type="button" data-action="edit-menu" data-id="${escapeHtml(menu.id)}" aria-label="${escapeHtml(menu.name)}を編集">${pencilIcon()}</button><button class="icon-button" type="button" data-action="delete-menu" data-id="${escapeHtml(menu.id)}" aria-label="${escapeHtml(menu.name)}を削除">${trashIcon()}</button></div></article>`).join('') : '<div class="empty-state"><strong>メニューはまだありません</strong><p>いつもの運動を登録すると、記録がもっと簡単になります。</p></div>';
    return `<header class="menu-toolbar"><div><p class="eyebrow">MAKE IT YOURS</p><h1>いつもの運動を、<br><em>自分らしく。</em></h1><p>あなたの定番メニューを登録。毎日の記録はタップするだけ。</p></div><button class="button button-primary" type="button" data-action="new-menu"><span aria-hidden="true">＋</span> メニューを追加</button></header>
      <div class="menu-layout"><section class="panel menu-list-panel"><div class="menu-list-head"><h2>登録中のメニュー</h2><span>${menus.length} 件</span></div>${list}</section><aside class="panel menu-aside"><p class="eyebrow">A GENTLE REMINDER</p><h2>メニューは、今の自分に合わせて。</h2><p>回数やセット数はいつでも変更できます。記録済みの日のメニュー名や回数は、その日の状態のまま残ります。</p><div class="aside-rule"></div><div class="aside-tip"><span>↗</span><p>迷ったら、続けやすい回数から始めてみましょう。</p></div></aside></div>`;
  }
  function renderSettings() {
    const recordCount = Object.values(data.records).filter(hasAnyRecord).length;
    return `<header class="page-heading"><div><p class="eyebrow">YOUR DATA, YOUR CHOICE</p><h1>大切な記録を、<em>自分の手元に。</em></h1><p class="page-subtitle">Move Plusの記録はこの端末のブラウザーに保存されます。</p></div></header>
      <div class="settings-grid"><section class="panel settings-panel"><div class="panel-head"><div><p class="eyebrow">DATA MANAGEMENT</p><h2>記録データ</h2></div><span class="storage-badge"><i></i>端末内保存</span></div><p>${recordCount}日分の記録 ・ ${data.menus.filter(menu => menu.active).length}件の運動メニュー</p>
        <div class="data-action"><span class="data-action-icon">${downloadIcon()}</span><div><h3>バックアップを書き出す</h3><p>メニューとすべての記録をJSONで保存します。</p></div><button class="button button-quiet" type="button" data-action="export">書き出す</button></div>
        <div class="data-action"><span class="data-action-icon">${uploadIcon()}</span><div><h3>バックアップを読み込む</h3><p>保存したJSONからデータを復元できます。</p></div><button class="button button-quiet" type="button" data-action="import">読み込む</button></div>
        <div class="danger-zone"><h3>記録をリセット</h3><p>この端末の記録とメニューを削除し、初期状態に戻します。</p><button class="button button-danger" type="button" data-action="reset">すべて削除する</button></div>
      </section><aside class="panel privacy-panel"><p class="eyebrow">PRIVATE BY DESIGN</p><h2>あなたの記録は、<br>あなたのもの。</h2><p>Move Plusはアカウント登録なしで使えます。入力内容はこのブラウザー内に保存され、外部サーバーへ送信されません。</p><ul class="privacy-list"><li>いつでもJSONで持ち出せる</li><li>バックアップから復元できる</li><li>データの削除はいつでも可能</li></ul></aside></div>`;
  }

  function pencilIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4.3-.8L19 8.5 15.5 5 4.8 15.7 4 20Z"/></svg>'; }
  function trashIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'; }
  function downloadIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3"/></svg>'; }
  function uploadIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 17v3h16v-3"/></svg>'; }

  function setView(view) {
    if (!['today', 'review', 'menus', 'settings'].includes(view)) return;
    if (view === 'review') syncSelectedDate(state.date);
    state.view = view; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function changeSet(exerciseId, delta, complete = false) {
    const record = ensureRecord(state.date); let item = record.exercises.find(exercise => exercise.id === exerciseId);
    if (!item) {
      const template = data.menus.find(menu => menu.id === exerciseId && menu.active);
      if (!template) return;
      item = menuSnapshot(template); record.exercises.push(item);
    }
    item.sets = complete ? item.targetSets : clampInt(item.sets + delta, 0, 30);
    scheduleSave(); render();
    if (item.sets >= item.targetSets) showToast('目標セット数まで記録しました');
  }
  function deleteDayExercise(exerciseId) {
    const record = recordFor(state.date); const item = record?.exercises.find(exercise => exercise.id === exerciseId);
    if (!item || item.sets <= 0) return;
    if (!confirm(`「${item.name}」のこの日の実績を削除しますか？\n運動メニューと他の記録は残ります。`)) return;
    item.sets = 0; record.updatedAt = new Date().toISOString(); saveData(false); render(); showToast('この日の実績を削除しました');
  }
  function moveMenu(menuId, delta) {
    const activeIndices = data.menus.map((menu, index) => menu.active ? index : -1).filter(index => index >= 0);
    const rank = activeIndices.findIndex(index => data.menus[index].id === menuId); const targetIndex = activeIndices[rank + Number(delta)];
    if (rank < 0 || targetIndex == null) return;
    const sourceIndex = activeIndices[rank]; [data.menus[sourceIndex], data.menus[targetIndex]] = [data.menus[targetIndex], data.menus[sourceIndex]];
    saveData(false); render(); showToast('メニューの並び順を変更しました');
  }
  function syncSelectedDate(date) {
    state.date = date; state.reviewDate = date; const selected = dateFromKey(date);
    state.reviewMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
  }
  function selectReviewDate(date, revealDetail = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dateToday) return;
    syncSelectedDate(date); render();
    if (revealDetail) requestAnimationFrame(() => $('#selected-day-panel')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }));
  }
  function openMenuEditor(menu = null) {
    form.reset(); $('#menu-id').value = menu?.id || ''; $('#menu-name').value = menu?.name || '';
    $('#menu-reps').value = menu?.reps || 10; $('#menu-sets').value = menu?.targetSets || 3;
    $('#dialog-title').textContent = menu ? 'メニューを編集' : '運動メニューを追加';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    setTimeout(() => $('#menu-name').focus(), 40);
  }
  function closeDialog() { if (dialog.open) dialog.close(); else dialog.removeAttribute('open'); }
  function saveMenu(event) {
    event.preventDefault(); const formData = new FormData(form); const existingId = String(formData.get('id') || '');
    const menu = { id: existingId || id(), name: String(formData.get('name') || '').trim(), reps: clampInt(formData.get('reps'), 1, 999), targetSets: clampInt(formData.get('targetSets'), 1, 30), active: true };
    if (!menu.name || !menu.reps || !menu.targetSets) return;
    const index = data.menus.findIndex(entry => entry.id === existingId);
    if (index >= 0) data.menus[index] = menu; else data.menus.push(menu);
    saveData(false); closeDialog(); render(); showToast(index >= 0 ? 'メニューを更新しました' : 'メニューを追加しました');
  }
  function removeMenu(menuId) {
    const menu = data.menus.find(item => item.id === menuId); if (!menu) return;
    if (!confirm(`「${menu.name}」をメニューから削除しますか？\nこれまでの記録には残ります。`)) return;
    data.menus = data.menus.filter(item => item.id !== menuId); saveData(false); render(); showToast('メニューを削除しました');
  }
  function updateWellness(target) {
    const record = ensureRecord(state.date);
    if (target.name === 'condition') record.condition = Number(target.value);
    else if (target.dataset.field === 'note') record.note = target.value.slice(0, 1000);
    else if (target.dataset.field === 'weight' || target.dataset.field === 'sleep') {
      const value = target.value;
      if (value !== '' && (Number(value) < Number(target.min) || Number(value) > Number(target.max))) { target.setCustomValidity(`入力できる範囲は${target.min}〜${target.max}です`); target.reportValidity(); return; }
      target.setCustomValidity(''); record[target.dataset.field] = value;
    } else return;
    record.updatedAt = new Date().toISOString(); scheduleSave();
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `move-plus-backup-${dateToday}.json`; link.click(); URL.revokeObjectURL(url); showToast('バックアップを書き出しました');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        if (!raw || !Array.isArray(raw.menus) || !raw.records || typeof raw.records !== 'object' || Array.isArray(raw.records)) throw new Error('format');
        const incoming = normalizeData(raw);
        if (!confirm('現在の記録を読み込んだデータで置き換えます。続けますか？')) return;
        data.schemaVersion = incoming.schemaVersion; data.menus = incoming.menus; data.records = incoming.records; data.preferences = incoming.preferences;
        saveData(false); render(); showToast('バックアップを読み込みました');
      } catch { showToast('このJSONファイルは読み込めませんでした', true); }
      $('#import-file').value = '';
    };
    reader.onerror = () => { showToast('ファイルを読み込めませんでした', true); $('#import-file').value = ''; };
    reader.readAsText(file);
  }
  function resetData() {
    if (!confirm('この端末に保存した運動メニューと記録をすべて削除します。この操作は元に戻せません。\n続ける前に必要なデータをバックアップしてください。')) return;
    data.menus = freshMenus(); data.records = {}; data.preferences = { theme: 'light' }; saveData(false); render(); showToast('記録をリセットしました');
  }
  function shiftDate(delta) {
    const date = dateFromKey(state.date); date.setDate(date.getDate() + Number(delta)); const key = localDate(date);
    if (key <= dateToday) { syncSelectedDate(key); render(); }
  }

  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { setView(viewButton.dataset.view); return; }
    const link = event.target.closest('[data-view-link]'); if (link) { event.preventDefault(); setView(link.dataset.viewLink); return; }
    const button = event.target.closest('[data-action]'); if (!button) return;
    switch (button.dataset.action) {
      case 'change-set': changeSet(button.dataset.id, Number(button.dataset.delta)); break;
      case 'complete-target': changeSet(button.dataset.id, 0, true); break;
      case 'date-shift': shiftDate(Number(button.dataset.delta)); break;
      case 'select-review-date': selectReviewDate(button.dataset.date, button.classList.contains('history-entry')); break;
      case 'chart-date': selectReviewDate(button.dataset.date, true); break;
      case 'open-date': if (button.dataset.date <= dateToday) { syncSelectedDate(button.dataset.date); setView('today'); } break;
      case 'month-shift': { const date = new Date(state.reviewMonth); date.setMonth(date.getMonth() + Number(button.dataset.delta)); state.reviewMonth = date; render(); break; }
      case 'trend-range': state.trendRange = clampInt(button.dataset.range, 7, 90); render(); break;
      case 'trend-metric': state.trendMetric = button.dataset.metric === 'activity' ? 'activity' : 'weight'; render(); break;
      case 'new-menu': openMenuEditor(); break;
      case 'edit-menu': openMenuEditor(data.menus.find(item => item.id === button.dataset.id)); break;
      case 'delete-menu': removeMenu(button.dataset.id); break;
      case 'delete-day-exercise': deleteDayExercise(button.dataset.id); break;
      case 'move-menu': moveMenu(button.dataset.id, Number(button.dataset.delta)); break;
      case 'close-dialog': closeDialog(); break;
      case 'export': exportData(); break;
      case 'import': $('#import-file').click(); break;
      case 'reset': resetData(); break;
      case 'retry-save': if (saveData(false)) showToast('記録を保存しました'); break;
    }
  });
  document.addEventListener('input', event => {
    const input = event.target;
    if (input.id === 'selected-date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.value) && input.value <= dateToday) { syncSelectedDate(input.value); render(); }
      return;
    }
    if (input.matches('[data-field]') && ['weight', 'sleep', 'note'].includes(input.dataset.field)) updateWellness(input);
  });
  document.addEventListener('change', event => {
    if (event.target.matches('input[name="condition"]')) { updateWellness(event.target); showToast('気分を記録しました'); }
    if (event.target.matches('#selected-date')) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value) && event.target.value <= dateToday) { syncSelectedDate(event.target.value); render(); }
    }
    if (event.target.matches('#import-file') && event.target.files?.[0]) importData(event.target.files[0]);
  });
  form.addEventListener('submit', saveMenu);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open) closeDialog();
    const chartTarget = event.target.closest?.('[data-action="chart-date"]');
    if (chartTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectReviewDate(chartTarget.dataset.date, true); }
  });

  // Migrate-once: preserve legacy values but use the new data model from this visit onward.
  if (!readJson(STORAGE_KEY)) saveData();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
  render();
})();
