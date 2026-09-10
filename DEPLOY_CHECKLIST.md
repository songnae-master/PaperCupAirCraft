# Railway 배포 체크리스트

- [ ] GitHub 저장소에 프로젝트 업로드
- [ ] Railway 새 프로젝트 생성
- [ ] PostgreSQL 서비스 추가
- [ ] GitHub 저장소로 App 서비스 생성
- [ ] App Variables에 `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- [ ] App Variables에 32자 이상 `SESSION_SECRET`
- [ ] App 서비스 배포 성공 확인
- [ ] `/health` → `{"ok":true}` 확인
- [ ] Networking → Generate Domain
- [ ] 교사 `teacher / 41234123` 최초 로그인
- [ ] 교사 비밀번호 즉시 변경
- [ ] 학생 테스트 계정으로 등록
- [ ] 학생 기록 제출 테스트
- [ ] 교사 대시보드에서 제출 확인
- [ ] 루브릭 평가 저장 테스트
- [ ] CSV 다운로드 테스트
