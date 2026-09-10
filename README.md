# 3-Force Flying Cup Challenge — Railway Edition

중학교 1학년 과학 **「여러 가지 힘」** 단원용 종이컵 비행체 수행평가 웹앱입니다.

이 버전은 학생 기록을 브라우저에만 저장하지 않고 다음 구조로 운영합니다.

```text
학생/교사 브라우저
        │ HTTPS
        ▼
Railway Express 서버
        │
        ▼
Railway PostgreSQL
```

학생용 HTML에는 데이터베이스 비밀번호나 관리자 키가 들어가지 않습니다.

## 핵심 기능

- 학생: **이름 + 숫자 4자리 PIN** 등록 및 로그인
- 학생 PIN: `bcrypt` 해시 저장
- 학생: 제작 포스터, 힘 개념, 45분 수행평가 활동
- 학생: 기본형/개선형 3회 측정 및 평균 비교
- 학생: **기록 제출** → Railway PostgreSQL 저장
- 재제출: 기존 기록을 덮어쓰지 않고 새 제출로 저장
- 교사: `teacher` 계정
- 초기 교사 비밀번호: `41234123`
- 최초 교사 로그인 후 **새 비밀번호 변경 강제**
- 교사: 등록/제출/평가완료/평가대기 현황 확인
- 교사: 학생 답안 열람
- 교사: 4영역 루브릭 평가 및 100점 자동 환산
- 교사: 전체 평가 결과 CSV 다운로드

## 평가 루브릭

| 영역 | 배점 |
|---|---:|
| 힘의 개념 이해 | 30 |
| 설계 근거 | 25 |
| 실험 수행 | 20 |
| 결과 해석 | 25 |
| **합계** | **100** |

최장거리 자체에는 점수를 주지 않고 **개념 적용과 탐구 과정**을 평가합니다.

---

# Railway에 배포하는 가장 간단한 방법

## 1. GitHub 저장소 만들기

이 프로젝트의 파일을 GitHub 저장소 루트에 그대로 올립니다.

```text
flying-cup-railway/
├─ package.json
├─ server.js
├─ .env.example
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ assets/
│     ├─ make-poster.png
│     └─ fly-poster.png
└─ sql/
   └─ schema.sql
```

## 2. Railway 프로젝트 만들기

Railway에서 새 프로젝트를 만들고 **PostgreSQL** 서비스를 추가합니다.

## 3. GitHub 저장소를 App 서비스로 배포

`New → GitHub Repo`에서 이 저장소를 선택합니다.

Railway는 `package.json`을 보고 Node.js 앱으로 인식하며 다음 명령을 사용합니다.

```text
npm start
```

## 4. App 서비스 환경변수 설정

App 서비스의 Variables에 다음을 추가합니다.

### DATABASE_URL

PostgreSQL 서비스의 `DATABASE_URL`을 참조합니다.

Railway 변수 입력값:

```text
${{Postgres.DATABASE_URL}}
```

Postgres 서비스 이름을 다르게 만들었다면 `Postgres` 부분도 해당 서비스 이름에 맞춥니다.

### SESSION_SECRET

32자 이상의 충분히 긴 무작위 문자열을 사용합니다.

Node.js가 있는 컴퓨터에서는 다음 명령으로 만들 수 있습니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

출력된 값을 Railway Variables의 `SESSION_SECRET`에 넣습니다.

```text
SESSION_SECRET=<생성된 긴 무작위 문자열>
```

이 값은 GitHub에 올리지 말고 Railway Variables에서만 관리하세요.

### 선택 사항

기본값은 이미 다음과 같습니다.

```text
INITIAL_TEACHER_ID=teacher
INITIAL_TEACHER_PASSWORD=41234123
DATABASE_SSL=false
```

학교 운영에서는 초기 로그인 직후 비밀번호를 변경하므로 `INITIAL_TEACHER_PASSWORD`는 따로 설정하지 않아도 됩니다.

## 5. Public Domain 만들기

App 서비스:

```text
Settings
→ Networking
→ Generate Domain
```

생성된 HTTPS 주소를 학생에게 배포합니다.

---

# 최초 교사 설정

배포 후 사이트에 접속합니다.

```text
아이디: teacher
초기 비밀번호: 41234123
```

처음 로그인하면 교사 비밀번호 변경 창이 자동으로 나타납니다.

새 비밀번호는 **8자 이상**이어야 하며 초기 비밀번호를 다시 사용할 수 없습니다.

변경된 비밀번호 원문은 PostgreSQL에 저장되지 않고 `bcrypt` 해시만 저장됩니다.

---

# 학생 사용

처음 접속한 학생:

1. 학생 탭 선택
2. 이름 입력
3. 숫자 4자리 PIN 입력
4. **처음 등록**
5. 수행평가 작성
6. **기록 제출**

다음 접속부터는 같은 이름과 PIN으로 로그인합니다.

## 동명이인

로그인 이름은 고유해야 합니다. 동명이인이 있으면 다음처럼 등록시키는 것을 권장합니다.

```text
홍길동 1-3 17
```

화면의 실제 이름 표시에도 이 문자열이 사용됩니다.

---

# 기록 제출

학생이 **기록 제출**을 누르면 서버가 다음을 검사한 뒤 PostgreSQL에 저장합니다.

- 학급과 번호
- 설계 변수와 변경 방법
- 예측
- 기본형 3회 측정
- 개선형 3회 측정
- 4~7번 서술 답안

평균과 향상거리는 **서버에서 다시 계산**하여 저장합니다.

학생 PIN은 제출 데이터에 포함되지 않습니다.

---

# 재제출

학생이 다시 제출하면 이전 제출을 삭제하거나 수정하지 않고 새 제출을 하나 더 만듭니다.

교사 대시보드는 각 학생의 **가장 최근 제출**을 기본으로 보여 줍니다.

이전 제출은 데이터베이스에 남아 있으므로 필요하면 추후 이력 보기 기능을 추가할 수 있습니다.

---

# 교사 대시보드

교사 로그인 후 다음 정보를 볼 수 있습니다.

- 등록 학생 수
- 제출 학생 수
- 평가 완료 수
- 평가 대기 수

학생을 선택하면 다음 내용을 볼 수 있습니다.

- 학급 / 번호 / 이름 / 모둠
- 기본형 평균
- 개선형 평균
- 향상거리
- 설계 변경
- 예측
- 4~8번 답안
- 교사용 루브릭

루브릭을 저장하면 PostgreSQL의 `assessments` 테이블에 기록됩니다.

---

# CSV 다운로드

교사 대시보드의 **전체 CSV** 버튼을 누르면 각 학생의 최신 제출을 기준으로 다음 내용을 내려받습니다.

- 학급
- 번호
- 이름
- 모둠
- 최종 제출 시각
- 기본형 평균
- 개선형 평균
- 향상거리
- 루브릭 4영역
- 총점
- 교사 피드백

Excel에서 바로 열 수 있도록 UTF-8 BOM이 포함됩니다.

---

# 개인정보 및 보안

이 프로젝트는 학교 수업을 고려하여 다음과 같이 구성했습니다.

- DB 접속 정보는 서버 환경변수에만 저장
- 학생 브라우저에서 PostgreSQL 직접 접근 불가
- 학생 PIN / 교사 비밀번호는 `bcrypt` 해시 저장
- 세션은 PostgreSQL에 저장
- 세션 쿠키는 `HttpOnly`
- Railway 환경에서는 `Secure` 쿠키
- `SameSite=Lax`
- Helmet 보안 헤더
- Content Security Policy
- 로그인 요청 Rate Limit
- 계정별 5회 로그인 실패 시 60초 잠금
- 학생 API와 교사 API 역할 분리
- SQL은 파라미터 바인딩 사용
- 교사만 제출 목록/답안/평가 API 접근 가능

### 4자리 PIN의 한계

4자리 PIN은 학생 사용 편의를 위한 방식으로 가능한 조합이 10,000개뿐입니다.

따라서 서버에서 로그인 시도 제한과 계정 잠금을 적용했지만 일반적인 긴 비밀번호보다 보안 강도는 낮습니다.

학생의 민감한 개인정보는 이 시스템에 추가로 저장하지 않는 것을 권장합니다.

---

# 데이터베이스

서버가 시작될 때 필요한 테이블을 자동 생성합니다.

- `users`
- `submissions`
- `assessments`
- `user_sessions`

따라서 일반적인 Railway 배포에서는 SQL을 수동 실행할 필요가 없습니다.

`sql/schema.sql`은 구조 확인 또는 수동 관리용 참고 파일입니다.

---

# 로컬 테스트

Node.js 20 이상과 PostgreSQL이 필요합니다.

```bash
npm install
cp .env.example .env
```

환경변수를 설정한 뒤:

```bash
npm start
```

접속:

```text
http://localhost:3000
```

> 이 프로젝트는 `dotenv`를 포함하므로 로컬에서는 `.env` 파일을 자동으로 읽습니다. `.env`는 `.gitignore`에 포함되어 GitHub에 업로드되지 않습니다.

---

# Railway 환경변수 체크리스트

필수:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<32자 이상의 무작위 문자열>
```

선택:

```text
INITIAL_TEACHER_ID=teacher
INITIAL_TEACHER_PASSWORD=41234123
DATABASE_SSL=false
```

---

# 건강 확인

서버 상태 확인용 경로:

```text
/health
```

정상일 때:

```json
{"ok":true}
```

---

# 수업 설계 의도

학생이 이미 배운 힘을 단순히 회상하는 것이 아니라 다음 흐름으로 적용하도록 설계했습니다.

```text
힘의 개념
→ 예측
→ 기본형 측정
→ 한 변인 변경
→ 개선형 측정
→ 평균 비교
→ 과학적 설명
```

종이컵 비행체가 회전하면서 예상과 다른 궤적을 보이면 수업 마지막에 **마그누스 효과**라는 후속 탐구 문제로 연결할 수 있습니다.


## 학교 네트워크에서의 동시 접속

학교에서는 수십~수백 대의 태블릿이 하나의 공인 IP를 공유할 수 있습니다. 이 프로젝트는 이를 고려해 로그인 IP 제한을 넉넉하게 두고, 실제 계정 보호는 **계정별 로그인 5회 실패 → 60초 잠금**으로 처리합니다.

학생 제출 속도 제한도 공인 IP가 아니라 **로그인한 학생 계정 단위**로 적용됩니다.
