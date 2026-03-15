---
title: DAG Publish → API Endpoint 생성 + 외부 서비스 연동
status: backlog
created: 2026-03-15
priority: high
---

## 요약

dag-designer에서 Publish 버튼을 누르면 해당 DAG에 대한 API endpoint가 생성되어, 외부 서비스가 이 API를 통해 DAG를 실행할 수 있어야 함.

## 핵심 설계 과제

### 1. API Endpoint 생성
- Publish 시 `/api/v1/workflows/{dagId}` 같은 endpoint 자동 생성
- 외부에서 이 endpoint에 POST 요청으로 DAG 실행 가능

### 2. Input 처리 — 디자이너 vs API의 차이
- **디자이너**: 사용자가 직접 파일 첨부 (image_source 노드에 파일 업로드)
- **API**: 외부 서비스가 파일을 input으로 전달 (multipart, base64, URL 등)

### 3. 고도의 설계 필요: 노드 config vs API input
- dag-designer에서 저장한 DAG의 첫 노드에 파일이 업로드되어 있음
- API로 실행할 때는 이 파일을 외부에서 받아야 함
- 어떤 노드의 어떤 config가 "API input으로 노출"되는지 정의해야 함
- DAG 정의에 "이 필드는 API에서 받는 input이다"라는 메타 정보 필요

### 4. 후보 설계 방향

**방향 A: Input Schema 정의**
- Publish 시 DAG의 "외부 input"을 정의하는 스키마 생성
- 예: `{ "image_a": { "type": "image", "required": true }, "prompt": { "type": "string" } }`
- API 요청 시 이 스키마에 맞는 데이터를 받아서 해당 노드의 config에 주입

**방향 B: Input Node 기반**
- DAG의 진입점 노드(input 타입)가 API input을 받는 역할
- 파일이 필요한 노드는 input 노드의 output으로 연결
- 디자이너에서는 테스트용으로 파일 직접 첨부, API에서는 input으로 전달

**방향 C: Config Override**
- API 요청 시 특정 노드의 config를 override하는 방식
- `{ "overrides": { "image_source_a_1": { "asset": { ... } } } }`

### 5. 관련 고려사항
- 인증: API endpoint 접근 시 인증 필요 (auth 패키지와 연동)
- 크레딧: API 실행 시 크레딧 차감 (credits 패키지와 연동)
- Rate limiting
- 실행 결과 반환 (동기 vs 비동기/webhook)
- 버전 관리 (published DAG의 버전)
