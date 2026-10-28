/* 체전 라이브 사이트 설정(설계 13 §6-5 W6 결정 2). 공개 주소만 둔다(비밀값 없음).
   CHEER_API: 응원 집계 Worker 주소(worker/cheer/, 배포 docs/DEPLOY.md §13). 비어 있으면 응원 보내기·응원 레이스가 모두 꺼진다.
   배포 뒤 "https://chejeon-cheer.<계정>.workers.dev" 꼴로 채우고 index.html 의 ?v= 를 갱신한다(tests/test_site.py 가 값을 알려 준다).
   PUSH_API·VAPID_PUBLIC: 알림 Worker(같은 Worker 의 /push 경로, docs/DEPLOY.md §13-N1)와 VAPID 공개 키(비밀 아님). 하나라도 비면 알림 기능 전체가 꺼진다(설계 14 X7). */
window.CHEJEON_CONFIG = { CHEER_API: "", PUSH_API: "", VAPID_PUBLIC: "" };
