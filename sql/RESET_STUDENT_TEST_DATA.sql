-- 선택 사항: 실제 학생 사용 전 기존 테스트 학생 데이터를 모두 지울 때만 실행하세요.
-- 교사 계정은 유지됩니다.
-- 주의: 실행하면 기존 학생 제출/평가 데이터가 복구 없이 삭제됩니다.

BEGIN;
DELETE FROM users WHERE role='student';
-- 오래된 학생 세션을 포함한 모든 로그인 세션도 초기화하려면 아래 줄의 주석을 제거할 수 있습니다.
-- DELETE FROM user_sessions;
COMMIT;
