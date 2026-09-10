'use strict';

require('dotenv').config();

const fs = require('fs');
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

const allowedHashesPath = path.join(__dirname, 'data', 'allowed-id-hashes.json');
const allowedIdHashes = new Set(JSON.parse(fs.readFileSync(allowedHashesPath, 'utf8')));
if (allowedIdHashes.size !== 150) {
  throw new Error('익명 ID 허용 목록은 중복 없는 150개여야 합니다.');
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
pool.on('error', err => console.error('PostgreSQL pool error:', err));

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'flyingcup.sid', secret: SESSION_SECRET, resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: 2 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'cross_site_blocked' });
  const origin = req.get('origin');
  if (origin) {
    const expected = `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) return res.status(403).json({ error: 'origin_mismatch' });
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'too_many_attempts', message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' }
});
const submissionLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 6,
  keyGenerator: req => String(req.session?.user?.id || 'anonymous'),
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'too_many_submissions', message: '제출 요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }
});

function normalizeAnonymousId(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\\s+/g, '');
}
function normalizeTeacherId(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}
function canonicalAnonymousId(value) {
  const normalized = normalizeAnonymousId(value);
  if (!/^[가-힣]{5}$/u.test(normalized)) return null;
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return allowedIdHashes.has(digest) ? normalized : null;
}
function cleanText(value, max=5000) { return String(value ?? '').trim().slice(0, max); }
function isFourDigitPin(pin) { return /^\\d{4}$/.test(String(pin || '')); }
function round3(n) { return Number(Number(n).toFixed(3)); }
function parseTriple(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const nums = value.map(Number);
  if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 100)) return null;
  return nums.map(round3);
}
function avg3(nums) { return round3((nums[0]+nums[1]+nums[2])/3); }
function scoreFromLevels(l) { return Math.round(30*l.concept/4 + 25*l.design/4 + 20*l.experiment/4 + 25*l.analysis/4); }
function csvEscape(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
function sessionUser(req) { return req.session?.user || null; }
function requireAuth(req,res,next){ if(!sessionUser(req)) return res.status(401).json({error:'not_authenticated'}); next(); }
function requireStudent(req,res,next){ const u=sessionUser(req); if(!u) return res.status(401).json({error:'not_authenticated'}); if(u.role!=='student') return res.status(403).json({error:'student_only'}); next(); }
function requireTeacher(req,res,next){ const u=sessionUser(req); if(!u) return res.status(401).json({error:'not_authenticated'}); if(u.role!=='teacher') return res.status(403).json({error:'teacher_only'}); if(u.mustChangePassword) return res.status(428).json({error:'password_change_required'}); next(); }
function setSessionUser(req,user){ req.session.user={id:user.id,role:user.role,loginName:user.login_name,displayName:user.display_name,mustChangePassword:Boolean(user.must_change_password)}; }

async function markFailedLogin(user){
  const next=(user.failed_attempts||0)+1;
  if(next>=5) await pool.query(`UPDATE users SET failed_attempts=0,lock_until=NOW()+INTERVAL '60 seconds',updated_at=NOW() WHERE id=$1`,[user.id]);
  else await pool.query(`UPDATE users SET failed_attempts=$2,updated_at=NOW() WHERE id=$1`,[user.id,next]);
}
async function clearLoginFailures(id){ await pool.query(`UPDATE users SET failed_attempts=0,lock_until=NULL,updated_at=NOW() WHERE id=$1`,[id]); }

async function initDb(){
  /* Migration-compatible schema: old profile columns may remain, but this code never writes personal profile data. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('student','teacher')),
      login_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
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
      baseline_avg NUMERIC(10,3), improved_avg NUMERIC(10,3), delta_m NUMERIC(10,3),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_student_time ON submissions(student_id,submitted_at DESC);
    CREATE TABLE IF NOT EXISTS assessments (
      id BIGSERIAL PRIMARY KEY,
      submission_id UUID NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
      teacher_id BIGINT NOT NULL REFERENCES users(id),
      concept_level SMALLINT NOT NULL CHECK(concept_level BETWEEN 1 AND 4),
      design_level SMALLINT NOT NULL CHECK(design_level BETWEEN 1 AND 4),
      experiment_level SMALLINT NOT NULL CHECK(experiment_level BETWEEN 1 AND 4),
      analysis_level SMALLINT NOT NULL CHECK(analysis_level BETWEEN 1 AND 4),
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      feedback TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const teacherLogin=normalizeTeacherId(INITIAL_TEACHER_ID);
  const existing=await pool.query(`SELECT id FROM users WHERE login_name=$1`,[teacherLogin]);
  if(!existing.rowCount){
    const hash=await bcrypt.hash(INITIAL_TEACHER_PASSWORD,12);
    await pool.query(`INSERT INTO users(role,login_name,display_name,password_hash,must_change_password) VALUES('teacher',$1,'교사',$2,TRUE)`,[teacherLogin,hash]);
    console.log(`Initial teacher account created: ${INITIAL_TEACHER_ID}`);
  }
}

app.get('/health', async(req,res)=>{ try{await pool.query('SELECT 1');res.json({ok:true,mode:'anonymous-id',allowedIds:allowedIdHashes.size});}catch{res.status(503).json({ok:false});} });
app.get('/api/auth/me',(req,res)=>{ const u=sessionUser(req); res.json(u?{authenticated:true,user:u}:{authenticated:false}); });

app.post('/api/student/register',authLimiter,async(req,res,next)=>{
  try{
    const anonymousId=canonicalAnonymousId(req.body.anonymousId);
    const pin=String(req.body.pin||'');
    if(!anonymousId) return res.status(400).json({error:'invalid_anonymous_id',message:'배정된 5글자 익명 ID가 아닙니다.'});
    if(!isFourDigitPin(pin)) return res.status(400).json({error:'invalid_pin',message:'PIN은 숫자 4자리입니다.'});
    const exists=await pool.query(`SELECT id FROM users WHERE login_name=$1`,[anonymousId]);
    if(exists.rowCount) return res.status(409).json({error:'already_registered',message:'이미 등록된 익명 ID입니다. 등록 때 정한 PIN으로 로그인하세요.'});
    const hash=await bcrypt.hash(pin,10);
    const result=await pool.query(`INSERT INTO users(role,login_name,display_name,password_hash) VALUES('student',$1,$1,$2) RETURNING *`,[anonymousId,hash]);
    setSessionUser(req,result.rows[0]);
    req.session.save(()=>res.status(201).json({ok:true,user:req.session.user}));
  }catch(e){next(e);}
});

app.post('/api/student/login',authLimiter,async(req,res,next)=>{
  try{
    const anonymousId=canonicalAnonymousId(req.body.anonymousId);
    const pin=String(req.body.pin||'');
    if(!anonymousId || !isFourDigitPin(pin)) return res.status(400).json({error:'invalid_credentials',message:'익명 ID와 숫자 4자리 PIN을 확인하세요.'});
    const result=await pool.query(`SELECT * FROM users WHERE login_name=$1 AND role='student'`,[anonymousId]);
    if(!result.rowCount) return res.status(401).json({error:'not_registered',message:'아직 등록되지 않은 ID입니다. 처음이면 ‘처음 등록’을 누르세요.'});
    const user=result.rows[0];
    if(user.lock_until && new Date(user.lock_until).getTime()>Date.now()) return res.status(423).json({error:'temporarily_locked',message:'로그인 실패가 반복되어 60초 동안 잠겼습니다.'});
    const ok=await bcrypt.compare(pin,user.password_hash);
    if(!ok){await markFailedLogin(user);return res.status(401).json({error:'invalid_credentials',message:'PIN이 맞지 않습니다.'});}
    await clearLoginFailures(user.id);
    req.session.regenerate(err=>{if(err)return res.status(500).json({error:'session_error'});setSessionUser(req,user);req.session.save(()=>res.json({ok:true,user:req.session.user}));});
  }catch(e){next(e);}
});

app.post('/api/teacher/login',authLimiter,async(req,res,next)=>{
  try{
    const id=normalizeTeacherId(req.body.id),password=String(req.body.password||'');
    const result=await pool.query(`SELECT * FROM users WHERE login_name=$1 AND role='teacher'`,[id]);
    if(!result.rowCount) return res.status(401).json({error:'invalid_credentials',message:'로그인 정보를 확인하세요.'});
    const user=result.rows[0];
    if(user.lock_until && new Date(user.lock_until).getTime()>Date.now()) return res.status(423).json({error:'temporarily_locked',message:'로그인 실패가 반복되어 60초 동안 잠겼습니다.'});
    if(!await bcrypt.compare(password,user.password_hash)){await markFailedLogin(user);return res.status(401).json({error:'invalid_credentials',message:'로그인 정보를 확인하세요.'});}
    await clearLoginFailures(user.id);
    req.session.regenerate(err=>{if(err)return res.status(500).json({error:'session_error'});setSessionUser(req,user);req.session.save(()=>res.json({ok:true,user:req.session.user}));});
  }catch(e){next(e);}
});

app.post('/api/logout',requireAuth,(req,res)=>{req.session.destroy(()=>{res.clearCookie('flyingcup.sid');res.json({ok:true});});});
app.post('/api/teacher/change-password',requireAuth,async(req,res,next)=>{
  try{
    const u=sessionUser(req);if(u.role!=='teacher')return res.status(403).json({error:'teacher_only'});
    const pw=String(req.body.newPassword||'');
    if(pw.length<8)return res.status(400).json({error:'weak_password',message:'새 비밀번호는 8자 이상으로 설정하세요.'});
    if(pw===INITIAL_TEACHER_PASSWORD)return res.status(400).json({error:'same_as_initial',message:'초기 비밀번호와 다른 비밀번호를 사용하세요.'});
    const hash=await bcrypt.hash(pw,12);
    await pool.query(`UPDATE users SET password_hash=$2,must_change_password=FALSE,failed_attempts=0,lock_until=NULL,updated_at=NOW() WHERE id=$1`,[u.id,hash]);
    req.session.user.mustChangePassword=false;req.session.save(()=>res.json({ok:true}));
  }catch(e){next(e);}
});

app.get('/api/student/latest',requireStudent,async(req,res,next)=>{
  try{const r=await pool.query(`SELECT id,baseline_avg,improved_avg,delta_m,submitted_at FROM submissions WHERE student_id=$1 ORDER BY submitted_at DESC LIMIT 1`,[sessionUser(req).id]);res.json({submission:r.rows[0]||null});}catch(e){next(e);}
});

app.post('/api/submissions',requireStudent,submissionLimiter,async(req,res,next)=>{
  try{
    const u=sessionUser(req),body=req.body||{};
    const changedVar=cleanText(body.changedVar,200),changeHow=cleanText(body.changeHow,500),prediction=cleanText(body.prediction,5000),resultChoice=cleanText(body.resultChoice,100);
    const baseline=parseTriple(body.baseline),improved=parseTriple(body.improved),answers=body.answers||{};
    if(!baseline||!improved)return res.status(400).json({error:'measurements_required',message:'기본형과 개선형을 각각 3회 측정하세요.'});
    if(!changedVar||!changeHow||!prediction)return res.status(400).json({error:'design_required',message:'설계 변수, 변경 방법, 예측을 작성하세요.'});
    const q4=cleanText(answers.q4),q5=cleanText(answers.q5),q6=cleanText(answers.q6),q7=cleanText(answers.q7),q8=cleanText(answers.q8);
    if(![q4,q5,q6,q7].every(Boolean))return res.status(400).json({error:'answers_required',message:'4~7번 서술 문항을 모두 작성하세요.'});
    const baselineAvg=avg3(baseline),improvedAvg=avg3(improved),delta=round3(improvedAvg-baselineAvg);
    const payload={anonymousId:u.displayName,changedVar,changeHow,prediction,baseline,improved,baselineAvg,improvedAvg,deltaM:delta,resultChoice,answers:{q4,q5,q6,q7,q8},submittedFrom:'railway-anonymous-v2'};
    const id=crypto.randomUUID();
    await pool.query(`INSERT INTO submissions(id,student_id,payload,baseline_avg,improved_avg,delta_m) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[id,u.id,JSON.stringify(payload),baselineAvg,improvedAvg,delta]);
    res.status(201).json({ok:true,submission:{id,baselineAvg,improvedAvg,deltaM:delta,submittedAt:new Date().toISOString()}});
  }catch(e){next(e);}
});

app.get('/api/teacher/stats',requireTeacher,async(req,res,next)=>{
  try{
    const r=await pool.query(`WITH latest AS (SELECT DISTINCT ON(student_id) id,student_id FROM submissions ORDER BY student_id,submitted_at DESC)
      SELECT (SELECT COUNT(*)::int FROM users WHERE role='student') registered,
             (SELECT COUNT(*)::int FROM latest) submitted,
             (SELECT COUNT(*)::int FROM latest l JOIN assessments a ON a.submission_id=l.id) assessed`);
    const x=r.rows[0];res.json({allocated:allowedIdHashes.size,registered:Number(x.registered),submitted:Number(x.submitted),assessed:Number(x.assessed),pendingAssessment:Number(x.submitted)-Number(x.assessed)});
  }catch(e){next(e);}
});

app.get('/api/teacher/submissions',requireTeacher,async(req,res,next)=>{
  try{
    const r=await pool.query(`WITH ranked AS (SELECT s.*,ROW_NUMBER() OVER(PARTITION BY s.student_id ORDER BY s.submitted_at DESC) rn FROM submissions s)
      SELECT r.id,r.student_id,r.submitted_at,r.baseline_avg,r.improved_avg,r.delta_m,u.display_name AS anonymous_id,a.score,(a.id IS NOT NULL) assessed
      FROM ranked r JOIN users u ON u.id=r.student_id LEFT JOIN assessments a ON a.submission_id=r.id
      WHERE r.rn=1 ORDER BY u.display_name`);
    res.json({submissions:r.rows});
  }catch(e){next(e);}
});

app.get('/api/teacher/submissions/:id',requireTeacher,async(req,res,next)=>{
  try{
    const r=await pool.query(`SELECT s.id,s.payload,s.submitted_at,s.baseline_avg,s.improved_avg,s.delta_m,u.display_name AS anonymous_id,
      a.concept_level,a.design_level,a.experiment_level,a.analysis_level,a.score,a.feedback,a.updated_at assessment_updated_at
      FROM submissions s JOIN users u ON u.id=s.student_id LEFT JOIN assessments a ON a.submission_id=s.id WHERE s.id=$1`,[req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:'not_found'});res.json({submission:r.rows[0]});
  }catch(e){next(e);}
});

app.put('/api/teacher/submissions/:id/assessment',requireTeacher,async(req,res,next)=>{
  try{
    const u=sessionUser(req),levels={concept:Number(req.body.concept),design:Number(req.body.design),experiment:Number(req.body.experiment),analysis:Number(req.body.analysis)};
    if(Object.values(levels).some(v=>!Number.isInteger(v)||v<1||v>4))return res.status(400).json({error:'invalid_levels',message:'4개 영역을 모두 1~4수준으로 선택하세요.'});
    const score=scoreFromLevels(levels),feedback=cleanText(req.body.feedback);
    const r=await pool.query(`INSERT INTO assessments(submission_id,teacher_id,concept_level,design_level,experiment_level,analysis_level,score,feedback)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(submission_id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id,concept_level=EXCLUDED.concept_level,design_level=EXCLUDED.design_level,
      experiment_level=EXCLUDED.experiment_level,analysis_level=EXCLUDED.analysis_level,score=EXCLUDED.score,feedback=EXCLUDED.feedback,updated_at=NOW() RETURNING *`,
      [req.params.id,u.id,levels.concept,levels.design,levels.experiment,levels.analysis,score,feedback]);
    res.json({ok:true,assessment:r.rows[0]});
  }catch(e){next(e);}
});

app.get('/api/teacher/export.csv',requireTeacher,async(req,res,next)=>{
  try{
    const r=await pool.query(`WITH ranked AS (SELECT s.*,ROW_NUMBER() OVER(PARTITION BY s.student_id ORDER BY s.submitted_at DESC) rn FROM submissions s)
      SELECT u.display_name anonymous_id,r.submitted_at,r.baseline_avg,r.improved_avg,r.delta_m,a.concept_level,a.design_level,a.experiment_level,a.analysis_level,a.score,a.feedback
      FROM ranked r JOIN users u ON u.id=r.student_id LEFT JOIN assessments a ON a.submission_id=r.id WHERE r.rn=1 ORDER BY u.display_name`);
    const head=['익명ID','최종제출시각','기본형평균(m)','개선형평균(m)','향상거리(m)','힘개념(4)','설계근거(4)','실험수행(4)','결과해석(4)','총점','교사피드백'];
    const lines=[head.map(csvEscape).join(',')];
    for(const x of r.rows) lines.push([x.anonymous_id,x.submitted_at?.toISOString?.()||x.submitted_at,x.baseline_avg,x.improved_avg,x.delta_m,x.concept_level,x.design_level,x.experiment_level,x.analysis_level,x.score,x.feedback].map(csvEscape).join(','));
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="flying-cup-anonymous-assessment.csv"');res.send('\\uFEFF'+lines.join('\\n'));
  }catch(e){next(e);}
});

app.use(express.static(path.join(__dirname,'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'not_found'});if(!['GET','HEAD'].includes(req.method))return next();res.sendFile(path.join(__dirname,'public','index.html'));});
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);res.status(500).json({error:'server_error',message:'서버 오류가 발생했습니다.'});});

async function start(){try{await pool.query('SELECT 1');await initDb();app.listen(PORT,'0.0.0.0',()=>console.log(`Flying Cup anonymous app listening on ${PORT}`));}catch(e){console.error('Startup failed:',e);process.exit(1);}}
start();
