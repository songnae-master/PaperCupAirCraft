# 익명 ID 버전 배포 체크리스트

- [ ] 교사용 배정표는 GitHub에 올리지 않음
- [ ] `data/allowed-id-hashes.json` 존재 확인
- [ ] `server.js` 새 버전 업로드
- [ ] `public/index.html` 새 버전 업로드
- [ ] `public/app.js` 새 버전 업로드
- [ ] `README.md`, `.gitignore`, `sql/schema.sql` 업데이트
- [ ] GitHub main 브랜치 Commit
- [ ] Railway 자동 재배포 확인
- [ ] `/health`에서 `mode: anonymous-id`, `allowedIds: 150` 확인
- [ ] 교사 로그인 확인
- [ ] 배정된 익명 ID 1개로 테스트 등록
- [ ] 임의의 미등록 ID가 거부되는지 확인
- [ ] 제출 후 교사 대시보드에 익명 ID만 보이는지 확인
- [ ] CSV에 이름·반·번호가 없는지 확인
