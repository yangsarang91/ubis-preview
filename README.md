# 유비스 · 우리 집 미리보기

손님이 1분 디자인 상담 → 3D 시안 → 방 사진 합성 → **AI 실사 시안** → 카카오톡 상담으로 이어지는 마케팅 랜딩 페이지입니다.

## 구성

| 경로 | 역할 |
|---|---|
| `public/index.html` | 손님용 페이지 (무드 상담, 3D 시안, 방 사진 합성, AI 실사 시안, 카톡 상담) |
| `public/photos/` | 실제 시공 사진 |
| `public/admin.html` | 관리자용 AI 시안 신청 목록 (`/admin.html`) |
| `functions/api/render.js` | 방 사진 + 디자인 → OpenAI 이미지 편집 → 실사 시안 |
| `functions/api/health.js` | AI 기능이 켜져 있는지 확인 (꺼져 있으면 페이지에서 AI 카드가 숨겨짐) |
| `functions/api/leads.js` | 관리자 키로 신청 목록 조회 |

## 배포 (Cloudflare Pages)

1. Cloudflare 가입 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → `ubis-preview` 선택
2. 빌드 설정: Framework preset **None**, Build command **비워 둠**, Build output directory **`public`**
3. **Save and Deploy**
4. **Workers & Pages → KV** → `ubis-kv` 이름으로 네임스페이스 생성
5. 프로젝트 **Settings → Bindings → Add → KV namespace**: Variable name `UBIS`, 네임스페이스 `ubis-kv`
6. **Settings → Variables and Secrets**:
   - `OPENAI_API_KEY` (Secret) — OpenAI API 키
   - `ADMIN_KEY` (Secret) — 관리자 페이지 비밀번호 (8자 이상)
   - 선택: `PER_PHONE_LIMIT`(기본 3), `PER_IP_DAILY`(기본 6), `DAILY_LIMIT`(기본 60), `INPUT_FIDELITY`(예: high), `IMAGE_QUALITY`(low/medium/high, 기본 medium), `OPENAI_IMAGE_MODEL`(기본 gpt-image-1)
7. **Deployments → Retry deployment** (설정 반영)

## 비용 보호

- 연락처(휴대폰 번호)당 생성 수 제한 (`PER_PHONE_LIMIT`)
- 같은 접속 IP 하루 생성 수 제한 (`PER_IP_DAILY`)
- 하루 전체 생성 수 상한 (`DAILY_LIMIT`)
- 생성 전에 미리 차감하고, 실패하면 되돌림 (동시 요청 방지)
- OpenAI 대시보드에서 월 사용 한도(Usage limit)도 꼭 설정하세요.

## 개인정보

- 저장: 성함, 휴대폰 번호, 선택한 디자인 (Cloudflare KV, 1년 후 자동 삭제)
- 방 사진은 OpenAI로 전송되어 시안 생성에만 쓰이고, 유비스 쪽에는 저장하지 않음
- 실제 운영 전 개인정보 처리방침(국외 이전 포함) 문구를 회사 기준으로 확인하세요.
