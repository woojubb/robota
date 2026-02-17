# Smoke Test Command Templates

## 1) Build

```bash
pnpm --filter "@robota-sdk/*" build
pnpm --filter @robota-sdk/api-server build
pnpm --filter @robota-sdk/web build
```

## 2) Check Running Servers

```bash
lsof -nP -iTCP:3011 -sTCP:LISTEN
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

## 3) Start Servers (if needed)

```bash
pnpm --filter @robota-sdk/api-server dag:dev
pnpm --filter @robota-sdk/web dev
```

## 4) API Smoke Examples

```bash
curl -s -o /tmp/api_health.txt -w "%{http_code}" http://localhost:3011/health
curl -s -o /tmp/dag_nodes.txt -w "%{http_code}" http://localhost:3011/v1/dag/nodes
```

Run smoke example:

```bash
node -e "fetch('http://localhost:3011/v1/dag/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({definition:YOUR_DEFINITION,input:{}})}).then(async r=>{const t=await r.text(); console.log('create status',r.status,t); const o=JSON.parse(t); return fetch('http://localhost:3011/v1/dag/runs/'+o.data.dagRunId+'/start',{method:'POST'}).then(async s=>console.log('start status',s.status,await s.text()));})"
```

## 5) UI Smoke Examples

```bash
curl -s -o /tmp/dag_designer.html -w "%{http_code}" http://localhost:3000/dag-designer
```

## 6) Retry Loop Guidance
- If a command fails, fix root cause first.
- Re-run the same failing command.
- Only continue after it passes.
