'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const INITIAL_TEACHER_ID = process.env.INITIAL_TEACHER_ID || 'teacher';
const INITIAL_TEACHER_PASSWORD = process.env.INITIAL_TEACHER_PASSWORD || '41234123';
const IS_RAILWAY = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME);
const IS_PROD = process.env.NODE_ENV === 'production' || IS_RAILWAY;

if (!DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET 환경변수를 32자 이상의 무작위 문자열로 설정하세요.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => console.error('PostgreSQL pool error:', err));

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  name: 'flyingcup.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000
  }
}));

// Cross-site mutation 차단. SameSite 쿠키와 함께 CSRF 위험을 낮춥니다.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return res.status(403).json({ error: 'cross_site_blocked' });

  const origin = req.get('origin');
  if (origin) {
    const expected = `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) return res.status(403).json({ error: 'origin_mismatch' });
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 학교 전체가 하나의 공인 IP(NAT)를 공유할 수 있으므로 IP 제한은 넉넉하게 둡니다.
  // 실제 계정 보호는 users.failed_attempts / lock_until의 5회 실패 잠금이 담당합니다.
  limit: 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'too_many_attempts', message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' }
});

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  keyGenerator: (req) => String(req.session?.user?.id || 'anonymous'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'too_many_submissions', message: '제출 요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }
});

function normalizeLoginName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}
function cleanText(value, max = 5000) {
  const s = String(value ?? '').trim();
  return s.slice(0, max);
}
function isFourDigitPin(pin) {
  return /^\d{4}$/.test(String(pin || ''));
}
function round3(n) {
  return Number(Number(n).toFixed(3));
}
function parseTriple(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const nums = value.map(Number);
  if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 100)) return null;
  return nums.map(round3);
}
function avg3(nums) {
  return round3((nums[0] + nums[1] + nums[2]) / 3);
}
function scoreFromLevels(levels) {
  return Math.round(
    30 * levels.concept / 4 +
    25 * levels.design / 4 +
    20 * levels.experiment / 4 +
    25 * levels.analysis / 4
  );
}
function csvEscape(v) {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}
function sessionUser(req) {
  return req.session && req.session.user ? req.session.user : null;
}
function requireAuth(req, res, next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  next();
}
function requireStudent(req, res, next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  if (u.role !== 'student') return res.status(403).json({ error: 'student_only' });
  next();
}
function requireTeacher(req, res, next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  if (u.role !== 'teacher') return res.status(403).json({ error: 'teacher_only' });
  if (u.mustChangePassword) return res.status(428).json({ error: 'password_change_required' });
  next();
}
async function markFailedLogin(user) {
  const next = (user.failed_attempts || 0) + 1;
  if (next >= 5) {
    await pool.query(
      `UPDATE users SET failed_attempts=0, lock_until=NOW() + INTERVAL '60 seconds', updated_at=NOW() WHERE id=$1`,
      [user.id]
    );
  } else {
    await pool.query(
      `UPDATE users SET failed_attempts=$2, updated_at=NOW() WHERE id=$1`,
      [user.id, next]
    );
  }
}
async function clearLoginFailures(userId) {
  await pool.query(`UPDATE users SET failed_attempts=0, lock_until=NULL, updated_at=NOW() WHERE id=$1`, [userId]);
}
function setSessionUser(req, user) {
  req.session.user = {
    id: user.id,
    role: user.role,
    loginName: user.login_name,
    displayName: user.display_name,
    className: user.class_name || '',
    studentNo: user.student_no || '',
    teamName: user.team_name || '',
    mustChangePassword: Boolean(user.must_change_password)
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('student','teacher')),
      login_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      class_name TEXT NOT NULL DEFAULT '',
      student_no TEXT NOT NULL DEFAULT '',
      team_name TEXT NOT NULL DEFAULT '',
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      lock_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id UUID PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      baseline_avg NUMERIC(10,3),
      improved_avg NUMERIC(10,3),
      delta_m NUMERIC(10,3),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_student_time
      ON submissions(student_id, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS assessments (
      id BIGSERIAL PRIMARY KEY,
      submission_id UUID NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
      teacher_id BIGINT NOT NULL REFERENCES users(id),
      concept_level SMALLINT NOT NULL CHECK (concept_level BETWEEN 1 AND 4),
      design_level SMALLINT NOT NULL CHECK (design_level BETWEEN 1 AND 4),
      experiment_level SMALLINT NOT NULL CHECK (experiment_level BETWEEN 1 AND 4),
      analysis_level SMALLINT NOT NULL CHECK (analysis_level BETWEEN 1 AND 4),
      score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
      feedback TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const teacherLogin = normalizeLoginName(INITIAL_TEACHER_ID);
  const existing = await pool.query(`SELECT id FROM users WHERE login_name=$1`, [teacherLogin]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(INITIAL_TEACHER_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users(role, login_name, display_name, password_hash, must_change_password)
       VALUES('teacher',$1,'교사',$2,TRUE)`,
      [teacherLogin, hash]
    );
    console.log(`Initial teacher account created: ${INITIAL_TEACHER_ID}`);
  }
}

// ---------------- Health ----------------
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// ---------------- Auth ----------------
app.get('/api/auth/me', async (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: u });
});

app.post('/api/student/register', authLimiter, async (req, res, next) => {
  try {
    const displayName = cleanText(req.body.name, 60);
    const loginName = normalizeLoginName(displayName);
    const pin = String(req.body.pin || '');

    if (displayName.length < 2) return res.status(400).json({ error: 'invalid_name', message: '이름을 2자 이상 입력하세요.' });
    if (!isFourDigitPin(pin)) return res.status(400).json({ error: 'invalid_pin', message: 'PIN은 숫자 4자리입니다.' });

    const exists = await pool.query(`SELECT id FROM users WHERE login_name=$1`, [loginName]);
    if (exists.rowCount) {
      return res.status(409).json({
        error: 'name_exists',
        message: '이미 등록된 이름입니다. 동명이인은 이름 뒤에 반·번호를 함께 입력하세요.'
      });
    }

    const hash = await bcrypt.hash(pin, 10);
    const result = await pool.query(
      `INSERT INTO users(role, login_name, display_name, password_hash)
       VALUES('student',$1,$2,$3)
       RETURNING *`,
      [loginName, displayName, hash]
    );
    setSessionUser(req, result.rows[0]);
    req.session.save(() => res.status(201).json({ ok: true, user: req.session.user }));
  } catch (err) { next(err); }
});

async function loginHandler(req, res, role) {
  const rawLogin = role === 'teacher' ? req.body.id : req.body.name;
  const loginName = normalizeLoginName(rawLogin);
  const secret = String(role === 'teacher' ? req.body.password : req.body.pin || '');

  if (!loginName || !secret) return res.status(400).json({ error: 'missing_credentials' });
  if (role === 'student' && !isFourDigitPin(secret)) {
    return res.status(400).json({ error: 'invalid_pin', message: 'PIN은 숫자 4자리입니다.' });
  }

  const result = await pool.query(`SELECT * FROM users WHERE login_name=$1 AND role=$2`, [loginName, role]);
  if (!result.rowCount) return res.status(401).json({ error: 'invalid_credentials', message: '로그인 정보를 확인하세요.' });

  const user = result.rows[0];
  if (user.lock_until && new Date(user.lock_until).getTime() > Date.now()) {
    return res.status(423).json({ error: 'temporarily_locked', message: '로그인 실패가 반복되어 60초 동안 잠겼습니다.' });
  }

  const ok = await bcrypt.compare(secret, user.password_hash);
  if (!ok) {
    await markFailedLogin(user);
    return res.status(401).json({ error: 'invalid_credentials', message: '로그인 정보를 확인하세요.' });
  }
  await clearLoginFailures(user.id);
  setSessionUser(req, user);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'session_error' });
    setSessionUser(req, user);
    req.session.save(() => res.json({ ok: true, user: req.session.user }));
  });
}

app.post('/api/student/login', authLimiter, (req, res, next) => {
  loginHandler(req, res, 'student').catch(next);
});
app.post('/api/teacher/login', authLimiter, (req, res, next) => {
  loginHandler(req, res, 'teacher').catch(next);
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('flyingcup.sid');
    res.json({ ok: true });
  });
});

app.post('/api/teacher/change-password', requireAuth, async (req, res, next) => {
  try {
    const u = sessionUser(req);
    if (u.role !== 'teacher') return res.status(403).json({ error: 'teacher_only' });

    const nextPassword = String(req.body.newPassword || '');
    if (nextPassword.length < 8) {
      return res.status(400).json({ error: 'weak_password', message: '새 비밀번호는 8자 이상으로 설정하세요.' });
    }
    if (nextPassword === INITIAL_TEACHER_PASSWORD) {
      return res.status(400).json({ error: 'same_as_initial', message: '초기 비밀번호와 다른 비밀번호를 사용하세요.' });
    }

    const hash = await bcrypt.hash(nextPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash=$2, must_change_password=FALSE, failed_attempts=0,
       lock_until=NULL, updated_at=NOW() WHERE id=$1`,
      [u.id, hash]
    );
    req.session.user.mustChangePassword = false;
    req.session.save(() => res.json({ ok: true }));
  } catch (err) { next(err); }
});

// ---------------- Student submissions ----------------
app.get('/api/student/latest', requireStudent, async (req, res, next) => {
  try {
    const u = sessionUser(req);
    const result = await pool.query(
      `SELECT id, baseline_avg, improved_avg, delta_m, submitted_at
       FROM submissions WHERE student_id=$1 ORDER BY submitted_at DESC LIMIT 1`,
      [u.id]
    );
    res.json({ submission: result.rows[0] || null });
  } catch (err) { next(err); }
});

app.post('/api/submissions', requireStudent, submissionLimiter, async (req, res, next) => {
  try {
    const u = sessionUser(req);
    const body = req.body || {};

    const className = cleanText(body.className, 30);
    const studentNo = cleanText(body.studentNo, 20);
    const teamName = cleanText(body.teamName, 40);
    const changedVar = cleanText(body.changedVar, 200);
    const changeHow = cleanText(body.changeHow, 500);
    const prediction = cleanText(body.prediction, 5000);
    const resultChoice = cleanText(body.resultChoice, 100);
    const answers = body.answers || {};

    const baseline = parseTriple(body.baseline);
    const improved = parseTriple(body.improved);

    if (!className || !studentNo) {
      return res.status(400).json({ error: 'profile_required', message: '학급과 번호를 입력하세요.' });
    }
    if (!baseline || !improved) {
      return res.status(400).json({ error: 'measurements_required', message: '기본형과 개선형을 각각 3회 측정하세요.' });
    }
    if (!changedVar || !changeHow || !prediction) {
      return res.status(400).json({ error: 'design_required', message: '설계 변수, 변경 방법, 예측을 작성하세요.' });
    }

    const q4 = cleanText(answers.q4, 5000);
    const q5 = cleanText(answers.q5, 5000);
    const q6 = cleanText(answers.q6, 5000);
    const q7 = cleanText(answers.q7, 5000);
    const q8 = cleanText(answers.q8, 5000);
    if (![q4, q5, q6, q7].every(Boolean)) {
      return res.status(400).json({ error: 'answers_required', message: '4~7번 서술 문항을 모두 작성하세요.' });
    }

    const baselineAvg = avg3(baseline);
    const improvedAvg = avg3(improved);
    const delta = round3(improvedAvg - baselineAvg);

    const payload = {
      studentName: u.displayName,
      className, studentNo, teamName,
      changedVar, changeHow, prediction,
      baseline, improved,
      baselineAvg, improvedAvg, deltaM: delta,
      resultChoice,
      answers: { q4, q5, q6, q7, q8 },
      submittedFrom: 'railway-web'
    };

    const id = crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET class_name=$2, student_no=$3, team_name=$4, updated_at=NOW() WHERE id=$1`,
        [u.id, className, studentNo, teamName]
      );
      await client.query(
        `INSERT INTO submissions(id, student_id, payload, baseline_avg, improved_avg, delta_m)
         VALUES($1,$2,$3::jsonb,$4,$5,$6)`,
        [id, u.id, JSON.stringify(payload), baselineAvg, improvedAvg, delta]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    req.session.user.className = className;
    req.session.user.studentNo = studentNo;
    req.session.user.teamName = teamName;

    res.status(201).json({
      ok: true,
      submission: { id, baselineAvg, improvedAvg, deltaM: delta, submittedAt: new Date().toISOString() }
    });
  } catch (err) { next(err); }
});

// ---------------- Teacher dashboard ----------------
app.get('/api/teacher/stats', requireTeacher, async (req, res, next) => {
  try {
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (student_id) id, student_id
        FROM submissions
        ORDER BY student_id, submitted_at DESC
      )
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE role='student') AS registered,
        (SELECT COUNT(*)::int FROM latest) AS submitted,
        (SELECT COUNT(*)::int FROM latest l JOIN assessments a ON a.submission_id=l.id) AS assessed
    `);
    const r = result.rows[0];
    res.json({
      registered: Number(r.registered),
      submitted: Number(r.submitted),
      assessed: Number(r.assessed),
      pendingAssessment: Number(r.submitted) - Number(r.assessed)
    });
  } catch (err) { next(err); }
});

app.get('/api/teacher/submissions', requireTeacher, async (req, res, next) => {
  try {
    const className = cleanText(req.query.className, 30);
    const params = [];
    let where = '';
    if (className) {
      params.push(className);
      where = `WHERE u.class_name=$${params.length}`;
    }

    const result = await pool.query(`
      WITH ranked AS (
        SELECT s.*, ROW_NUMBER() OVER(PARTITION BY s.student_id ORDER BY s.submitted_at DESC) AS rn
        FROM submissions s
      )
      SELECT
        r.id, r.student_id, r.submitted_at, r.baseline_avg, r.improved_avg, r.delta_m,
        u.display_name, u.class_name, u.student_no, u.team_name,
        a.score, (a.id IS NOT NULL) AS assessed
      FROM ranked r
      JOIN users u ON u.id=r.student_id
      LEFT JOIN assessments a ON a.submission_id=r.id
      ${where}
      AND r.rn=1
      ORDER BY u.class_name, NULLIF(regexp_replace(u.student_no, '\\D','','g'),'')::int NULLS LAST,
               u.student_no, u.display_name
    `.replace(`${where}\n      AND`, where ? `${where}\n      AND` : 'WHERE'), params);

    res.json({ submissions: result.rows });
  } catch (err) { next(err); }
});

app.get('/api/teacher/submissions/:id', requireTeacher, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.payload, s.submitted_at, s.baseline_avg, s.improved_avg, s.delta_m,
             u.display_name, u.class_name, u.student_no, u.team_name,
             a.concept_level, a.design_level, a.experiment_level, a.analysis_level,
             a.score, a.feedback, a.updated_at AS assessment_updated_at
      FROM submissions s
      JOIN users u ON u.id=s.student_id
      LEFT JOIN assessments a ON a.submission_id=s.id
      WHERE s.id=$1
    `, [req.params.id]);

    if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ submission: result.rows[0] });
  } catch (err) { next(err); }
});

app.put('/api/teacher/submissions/:id/assessment', requireTeacher, async (req, res, next) => {
  try {
    const u = sessionUser(req);
    const levels = {
      concept: Number(req.body.concept),
      design: Number(req.body.design),
      experiment: Number(req.body.experiment),
      analysis: Number(req.body.analysis)
    };
    if (Object.values(levels).some(v => !Number.isInteger(v) || v < 1 || v > 4)) {
      return res.status(400).json({ error: 'invalid_levels', message: '모든 평가 영역을 1~4수준으로 선택하세요.' });
    }

    const exists = await pool.query(`SELECT id FROM submissions WHERE id=$1`, [req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'not_found' });

    const score = scoreFromLevels(levels);
    const feedback = cleanText(req.body.feedback, 5000);

    const result = await pool.query(`
      INSERT INTO assessments(
        submission_id, teacher_id, concept_level, design_level, experiment_level, analysis_level, score, feedback
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(submission_id) DO UPDATE SET
        teacher_id=EXCLUDED.teacher_id,
        concept_level=EXCLUDED.concept_level,
        design_level=EXCLUDED.design_level,
        experiment_level=EXCLUDED.experiment_level,
        analysis_level=EXCLUDED.analysis_level,
        score=EXCLUDED.score,
        feedback=EXCLUDED.feedback,
        updated_at=NOW()
      RETURNING *
    `, [req.params.id, u.id, levels.concept, levels.design, levels.experiment, levels.analysis, score, feedback]);

    res.json({ ok: true, assessment: result.rows[0] });
  } catch (err) { next(err); }
});

app.get('/api/teacher/export.csv', requireTeacher, async (req, res, next) => {
  try {
    const result = await pool.query(`
      WITH ranked AS (
        SELECT s.*, ROW_NUMBER() OVER(PARTITION BY s.student_id ORDER BY s.submitted_at DESC) AS rn
        FROM submissions s
      )
      SELECT u.class_name, u.student_no, u.display_name, u.team_name,
             r.submitted_at, r.baseline_avg, r.improved_avg, r.delta_m,
             a.concept_level, a.design_level, a.experiment_level, a.analysis_level,
             a.score, a.feedback
      FROM ranked r
      JOIN users u ON u.id=r.student_id
      LEFT JOIN assessments a ON a.submission_id=r.id
      WHERE r.rn=1
      ORDER BY u.class_name, u.student_no, u.display_name
    `);

    const header = [
      '학급','번호','이름','모둠','최종제출시각',
      '기본형평균(m)','개선형평균(m)','향상거리(m)',
      '힘개념(4)','설계근거(4)','실험수행(4)','결과해석(4)','총점','교사피드백'
    ];
    const lines = [header.map(csvEscape).join(',')];
    for (const r of result.rows) {
      lines.push([
        r.class_name, r.student_no, r.display_name, r.team_name, r.submitted_at?.toISOString?.() || r.submitted_at,
        r.baseline_avg, r.improved_avg, r.delta_m,
        r.concept_level, r.design_level, r.experiment_level, r.analysis_level, r.score, r.feedback
      ].map(csvEscape).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="flying-cup-assessment.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) { next(err); }
});

// ---------------- Static ----------------
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: IS_PROD ? '1h' : 0
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error', message: '서버 오류가 발생했습니다.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Flying Cup app listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
