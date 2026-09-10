# 3-Force Flying Cup Challenge — Anonymous ID Railway Edition

중학교 1학년 과학 수행평가용 Railway + Express + PostgreSQL 앱입니다.

## 개인정보 최소화 원칙

이 버전의 앱은 학생에게 다음 정보만 요구합니다.

```text
5글자 익명 ID
숫자 4자리 PIN
```

앱과 PostgreSQL에는 다음 정보를 입력하거나 저장하지 않습니다.

```text
학생 이름
반
번호
전화번호
이메일
```

실제 학생과 익명 ID의 대응은 **교사용 오프라인 배정표에서만 별도로 관리**합니다. 그 배정표는 GitHub나 Railway에 업로드하지 마세요.

## 익명 ID

- 1학년 1~5반 × 30명 = 총 150개
- 150개 모두 고유한 한글 5글자 ID
- 서버는 사전에 생성된 150개 ID의 SHA-256 허용 해시와 일치할 때만 신규 등록 허용
- 이미 등록된 ID는 다시 등록할 수 없음

예:

```text
몽글토끼별
구름해파리
반짝고래별
```

GitHub에는 실제 익명 ID 목록 대신 `data/allowed-id-hashes.json`의 SHA-256 해시만 포함됩니다. 실제 이름/반/번호와의 연결 정보는 전혀 포함되지 않습니다.

## 학생 흐름

```text
배부된 익명 ID 입력
→ 처음 접속: 4자리 PIN 등록
→ 이후: 익명 ID + PIN 로그인
→ 활동 작성
→ 기록 제출
→ Railway PostgreSQL 저장
```

PIN 원문은 저장하지 않고 `bcrypt` 해시만 저장합니다.

## 교사

```text
ID: teacher
초기 비밀번호: 41234123
```

최초 로그인 후 8자 이상의 새 비밀번호로 변경해야 합니다.

교사 대시보드에도 실제 이름 대신 익명 ID만 나타납니다.

## Railway 환경변수

기존에 설정한 두 변수만 있으면 됩니다.

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<32자 이상의 무작위 문자열>
```

추가 Supabase 설정은 필요 없습니다.

## 현재 GitHub 저장소 업데이트 방법

기존 저장소에서 다음 파일/폴더를 새 버전으로 덮어씁니다.

```text
server.js
README.md
.gitignore
public/index.html
public/app.js
sql/schema.sql
```

그리고 새 폴더를 추가합니다.

```text
data/allowed-id-hashes.json
```

`package.json`, `public/styles.css`, `public/assets/`는 기존 파일을 그대로 사용할 수 있습니다.

GitHub main 브랜치에 Commit하면 Railway가 GitHub 서비스와 연결된 경우 자동 재배포됩니다.

## 기존 DB와 호환

이전 코드가 이미 PostgreSQL에 `class_name`, `student_no`, `team_name` 컬럼을 만들었더라도 삭제할 필요가 없습니다. 새 코드는 이 컬럼을 읽거나 쓰지 않습니다.

실제 학생 사용 전에 테스트 계정에 이름/반/번호를 넣은 적이 있다면 그 테스트 데이터는 별도로 정리하는 것을 권장합니다.

## 매우 중요한 파일 분리

GitHub/Railway에 올려도 되는 파일:

```text
data/allowed-id-hashes.json
```

여기에는 익명 ID 150개만 있고 실제 학생과의 연결이 없습니다.

GitHub/Railway에 올리면 안 되는 파일:

```text
중1_5글자익명ID_교사용_배정표.html
중1_5글자익명ID_배정표.md
학생 이름과 ID를 연결해 둔 문서
```

`.gitignore`에도 교사용 배정표가 실수로 올라가지 않도록 패턴을 추가했습니다.

## 교사 CSV

CSV에도 다음 정보만 저장됩니다.

```text
익명 ID
최종 제출 시각
측정 평균
향상거리
루브릭 수준
총점
교사 피드백
```

이름·반·번호는 포함되지 않습니다.


## 실제 수업 전 기존 테스트 데이터 정리

이전 이름 기반 버전으로 학생 테스트 계정을 만들어 본 적이 있다면, 실제 수업 시작 전에 Railway PostgreSQL에서 `sql/RESET_STUDENT_TEST_DATA.sql`을 **한 번만 선택적으로 실행**할 수 있습니다.

이 SQL은 교사 계정을 남기고 기존 학생 계정·제출·평가를 삭제합니다. 기존 학생 기록이 필요한 경우에는 실행하면 안 됩니다.

## 루트의 예전 index.html

이 Express 앱은 `public/index.html`만 사용합니다. 이전 GitHub 저장소 루트에 별도의 `index.html`이 남아 있다면 혼동 방지를 위해 삭제해도 됩니다. Railway 동작 자체에는 영향을 주지 않습니다.
