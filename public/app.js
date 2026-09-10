'use strict';

const $ = (id) => document.getElementById(id);
let currentUser = null;
let teacherRows = [];
let currentSubmissionId = null;

async function api(url, options = {}) {
  const opts = { credentials: 'same-origin', ...options };
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, opts);
  const contentType = r.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function setMsg(id, text = '', kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg' + (kind ? ` ${kind}` : '');
}
function showAuthTab(which) {
  $('studentTabBtn').classList.toggle('active', which === 'student');
  $('teacherTabBtn').classList.toggle('active', which === 'teacher');
  $('studentAuth').classList.toggle('active', which === 'student');
  $('teacherAuth').classList.toggle('active', which === 'teacher');
}
function pinOnly(el) {
  el.value = el.value.replace(/\D/g, '').slice(0, 4);
}
function fmt(n) {
  if (n === null || n === undefined || n === '') return '—';
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : '—';
}
function getTriple(prefix) {
  const vals = [1, 2, 3].map(i => Number($(`${prefix}${i}`).value));
  return vals.every(Number.isFinite) ? vals : null;
}
function calcMeans() {
  const b = getTriple('b');
  const a = getTriple('a');
  const bAvg = b ? b.reduce((x, y) => x + y, 0) / 3 : null;
  const aAvg = a ? a.reduce((x, y) => x + y, 0) / 3 : null;
  $('bavg').textContent = bAvg === null ? '—' : bAvg.toFixed(2);
  $('aavg').textContent = aAvg === null ? '—' : aAvg.toFixed(2);
  $('delta').textContent = bAvg === null || aAvg === null ? '— m' : `${aAvg - bAvg >= 0 ? '+' : ''}${(aAvg - bAvg).toFixed(2)} m`;
}

function applyUser(user) {
  currentUser = user;
  document.body.classList.remove('role-student', 'role-teacher');
  document.body.classList.add(`role-${user.role}`);
  $('authPage').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('appRoot').classList.remove('hidden');
  $('whoami').textContent = user.role === 'teacher' ? '교사 · teacher' : `학생 · ${user.displayName}`;

  if (user.role === 'student') {
    $('studentApp').classList.remove('hidden');
    $('teacherApp').classList.add('hidden');
    $('studentName').value = user.displayName;
    $('className').value = user.className || '';
    $('studentNo').value = user.studentNo || '';
    $('teamName').value = user.teamName || '';
    loadLatestSubmission();
  } else {
    $('teacherApp').classList.remove('hidden');
    $('studentApp').classList.add('hidden');
    if (user.mustChangePassword) {
      $('passwordModal').classList.remove('hidden');
    } else {
      loadDashboard();
    }
  }
}

async function checkSession() {
  try {
    const data = await api('/api/auth/me');
    if (data.authenticated) applyUser(data.user);
  } catch {}
}

async function studentRegister() {
  setMsg('studentAuthMsg');
  const name = $('studentNameLogin').value.trim();
  const pin = $('studentPinLogin').value;
  try {
    const data = await api('/api/student/register', { method: 'POST', body: { name, pin } });
    applyUser(data.user);
  } catch (e) {
    setMsg('studentAuthMsg', e.message, 'error');
  }
}
async function studentLogin() {
  setMsg('studentAuthMsg');
  try {
    const data = await api('/api/student/login', {
      method: 'POST',
      body: { name: $('studentNameLogin').value.trim(), pin: $('studentPinLogin').value }
    });
    applyUser(data.user);
  } catch (e) { setMsg('studentAuthMsg', e.message, 'error'); }
}
async function teacherLogin() {
  setMsg('teacherAuthMsg');
  try {
    const data = await api('/api/teacher/login', {
      method: 'POST',
      body: { id: $('teacherIdLogin').value.trim(), password: $('teacherPwLogin').value }
    });
    applyUser(data.user);
  } catch (e) { setMsg('teacherAuthMsg', e.message, 'error'); }
}
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
}
async function changeTeacherPassword() {
  setMsg('changePwMsg');
  const p1 = $('newTeacherPw').value;
  const p2 = $('newTeacherPw2').value;
  if (p1 !== p2) return setMsg('changePwMsg', '새 비밀번호 확인이 일치하지 않습니다.', 'error');
  try {
    await api('/api/teacher/change-password', { method: 'POST', body: { newPassword: p1 } });
    currentUser.mustChangePassword = false;
    $('passwordModal').classList.add('hidden');
    $('newTeacherPw').value = '';
    $('newTeacherPw2').value = '';
    await loadDashboard();
  } catch (e) { setMsg('changePwMsg', e.message, 'error'); }
}

function collectActivity() {
  return {
    className: $('className').value.trim(),
    studentNo: $('studentNo').value.trim(),
    teamName: $('teamName').value.trim(),
    changedVar: $('changedVar').value.trim(),
    changeHow: $('changeHow').value.trim(),
    prediction: $('prediction').value.trim(),
    baseline: [Number($('b1').value), Number($('b2').value), Number($('b3').value)],
    improved: [Number($('a1').value), Number($('a2').value), Number($('a3').value)],
    resultChoice: $('resultChoice').value,
    answers: {
      q4: $('q4').value.trim(),
      q5: $('q5').value.trim(),
      q6: $('q6').value.trim(),
      q7: $('q7').value.trim(),
      q8: $('q8').value.trim()
    }
  };
}

async function submitActivity(event) {
  event.preventDefault();
  const btn = $('submitBtn');
  $('submitResult').textContent = '';
  if (!$('activityForm').reportValidity()) return;
  if (!confirm('현재 기록을 최종 제출할까요? 재제출하면 새 제출 기록으로 저장됩니다.')) return;

  btn.disabled = true;
  btn.textContent = '제출 중…';
  try {
    const data = await api('/api/submissions', { method: 'POST', body: collectActivity() });
    const time = new Date(data.submission.submittedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    $('submitResult').textContent = `✓ 제출 완료 · ${time}`;
    $('submitResult').style.color = 'var(--green)';
    await loadLatestSubmission();
  } catch (e) {
    $('submitResult').textContent = `제출 실패 · ${e.message}`;
    $('submitResult').style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
    btn.textContent = '기록 제출';
  }
}
async function loadLatestSubmission() {
  try {
    const data = await api('/api/student/latest');
    if (!data.submission) {
      $('latestSubmission').textContent = '아직 제출한 기록이 없습니다.';
      return;
    }
    const t = new Date(data.submission.submitted_at).toLocaleString('ko-KR');
    $('latestSubmission').textContent = `최근 제출: ${t} · 향상거리 ${fmt(data.submission.delta_m)} m`;
  } catch {}
}

// ---------------- Teacher dashboard ----------------
async function loadDashboard() {
  if (!currentUser || currentUser.role !== 'teacher' || currentUser.mustChangePassword) return;
  try {
    const [stats, list] = await Promise.all([
      api('/api/teacher/stats'),
      api('/api/teacher/submissions')
    ]);
    $('statRegistered').textContent = stats.registered;
    $('statSubmitted').textContent = stats.submitted;
    $('statAssessed').textContent = stats.assessed;
    $('statPending').textContent = stats.pendingAssessment;
    teacherRows = list.submissions || [];
    renderStudentList();
  } catch (e) {
    if (e.status === 428) $('passwordModal').classList.remove('hidden');
  }
}
function renderStudentList() {
  const q = $('teacherSearch').value.trim().toLowerCase();
  const list = $('studentList');
  list.replaceChildren();

  const filtered = teacherRows.filter(r => {
    const hay = `${r.display_name} ${r.class_name} ${r.student_no} ${r.team_name}`.toLowerCase();
    return !q || hay.includes(q);
  });

  if (!filtered.length) {
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = '제출 기록이 없습니다.';
    list.appendChild(p);
    return;
  }

  for (const r of filtered) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'student-item' + (r.id === currentSubmissionId ? ' active' : '');
    const top = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${r.class_name} ${r.student_no} ${r.display_name}`;
    top.appendChild(strong);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${r.assessed ? `평가 ${r.score}점` : '평가 대기'} · ${new Date(r.submitted_at).toLocaleString('ko-KR')}`;
    b.append(top, meta);
    b.addEventListener('click', () => openSubmission(r.id));
    list.appendChild(b);
  }
}
function clearRubric() {
  document.querySelectorAll('.rubric input[type=radio]').forEach(el => el.checked = false);
  $('teacherFeedback').value = '';
  $('teacherScore').textContent = '0';
  setMsg('assessmentMsg');
}
function setRubric(name, value) {
  if (!value) return;
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}
function rubricScore() {
  const weights = { concept: 30, design: 25, experiment: 20, analysis: 25 };
  let score = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    if (checked) score += weight * Number(checked.value) / 4;
  }
  $('teacherScore').textContent = String(Math.round(score));
}
function addAnswer(container, title, text) {
  const h = document.createElement('h3');
  h.style.marginTop = '12px';
  h.textContent = title;
  const d = document.createElement('div');
  d.className = 'answer-box';
  d.textContent = text || '—';
  container.append(h, d);
}
async function openSubmission(id) {
  currentSubmissionId = id;
  renderStudentList();
  clearRubric();
  try {
    const data = await api(`/api/teacher/submissions/${encodeURIComponent(id)}`);
    const s = data.submission;
    const p = s.payload || {};

    $('teacherEmpty').classList.add('hidden');
    $('submissionDetail').classList.remove('hidden');
    $('detailTitle').textContent = `${s.class_name} ${s.student_no} ${s.display_name}`;
    $('detailMeta').textContent = `${s.team_name || '모둠 미입력'} · 제출 ${new Date(s.submitted_at).toLocaleString('ko-KR')}`;
    $('dBaseline').textContent = `${fmt(s.baseline_avg)} m`;
    $('dImproved').textContent = `${fmt(s.improved_avg)} m`;
    $('dDelta').textContent = `${Number(s.delta_m) >= 0 ? '+' : ''}${fmt(s.delta_m)} m`;
    $('dDesign').textContent = `${p.changedVar || '—'} / ${p.changeHow || '—'}`;
    $('dPrediction').textContent = p.prediction || '—';

    const answers = $('answerDetails');
    answers.replaceChildren();
    addAnswer(answers, '4. 평균 비행거리 결과', p.answers?.q4);
    addAnswer(answers, '5. 힘의 개념으로 결과 설명', p.answers?.q5);
    addAnswer(answers, '6. 같게 해야 할 조건', p.answers?.q6);
    addAnswer(answers, '7. 자유 비행 중 탄성력 판단', p.answers?.q7);
    addAnswer(answers, '8. 추가 관찰', p.answers?.q8);

    setRubric('concept', s.concept_level);
    setRubric('design', s.design_level);
    setRubric('experiment', s.experiment_level);
    setRubric('analysis', s.analysis_level);
    $('teacherFeedback').value = s.feedback || '';
    rubricScore();
  } catch (e) {
    alert(`제출 기록을 불러오지 못했습니다: ${e.message}`);
  }
}
async function saveAssessment() {
  if (!currentSubmissionId) return;
  const levels = {};
  for (const name of ['concept', 'design', 'experiment', 'analysis']) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    if (!checked) return setMsg('assessmentMsg', '4개 영역을 모두 선택하세요.', 'error');
    levels[name] = Number(checked.value);
  }
  try {
    const data = await api(`/api/teacher/submissions/${encodeURIComponent(currentSubmissionId)}/assessment`, {
      method: 'PUT',
      body: { ...levels, feedback: $('teacherFeedback').value.trim() }
    });
    $('teacherScore').textContent = data.assessment.score;
    setMsg('assessmentMsg', '평가를 저장했습니다.', 'ok');
    await loadDashboard();
    currentSubmissionId = data.assessment.submission_id;
    renderStudentList();
  } catch (e) { setMsg('assessmentMsg', e.message, 'error'); }
}

function showTeacherDashboard() {
  $('teacherApp').classList.remove('hidden');
  $('studentApp').classList.add('hidden');
  loadDashboard();
}
function showStudentPreview() {
  $('teacherApp').classList.add('hidden');
  $('studentApp').classList.remove('hidden');
  $('studentName').value = '학생 화면 미리보기';
}

// ---------------- Events ----------------
$('studentTabBtn').addEventListener('click', () => showAuthTab('student'));
$('teacherTabBtn').addEventListener('click', () => showAuthTab('teacher'));
$('studentPinLogin').addEventListener('input', e => pinOnly(e.target));
$('studentRegisterBtn').addEventListener('click', studentRegister);
$('studentLoginBtn').addEventListener('click', studentLogin);
$('teacherLoginBtn').addEventListener('click', teacherLogin);
$('logoutBtn').addEventListener('click', logout);
$('changeTeacherPwBtn').addEventListener('click', changeTeacherPassword);
$('activityForm').addEventListener('submit', submitActivity);
$('printBtn').addEventListener('click', () => window.print());
['b1','b2','b3','a1','a2','a3'].forEach(id => $(id).addEventListener('input', calcMeans));
document.querySelectorAll('.rubric input[type=radio]').forEach(el => el.addEventListener('change', rubricScore));
$('saveAssessmentBtn').addEventListener('click', saveAssessment);
$('refreshDashboardBtn').addEventListener('click', loadDashboard);
$('teacherSearch').addEventListener('input', renderStudentList);
$('dashboardBtn').addEventListener('click', showTeacherDashboard);
$('studentViewBtn').addEventListener('click', showStudentPreview);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!$('authPage').classList.contains('hidden')) {
    if ($('studentAuth').classList.contains('active')) studentLogin();
    else teacherLogin();
  }
});

calcMeans();
checkSession();
