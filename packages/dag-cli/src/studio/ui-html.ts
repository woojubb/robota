/** Embedded single-page app served by `dag studio`. */
export function buildStudioHtml(): string {
  // Note: \n in JS string literals inside the template become literal newlines in the browser —
  // which is exactly what the SSE stream contains. Escaping as \\n keeps the correct runtime behaviour.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DAG Studio</title>
<style>
:root{--bg:#0f172a;--sur:#1e293b;--bdr:#334155;--txt:#e2e8f0;--mut:#94a3b8;--blu:#3b82f6;--grn:#22c55e;--red:#ef4444}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px}
body{display:flex;flex-direction:column;overflow:hidden}
#hdr{background:var(--sur);border-bottom:1px solid var(--bdr);padding:10px 16px;display:flex;align-items:center;gap:8px;flex-shrink:0}
#logo{font-weight:700;font-size:15px;color:var(--blu);white-space:nowrap;margin-right:4px}
#file-in{flex:1;background:var(--bg);border:1px solid var(--bdr);border-radius:6px;padding:6px 10px;color:var(--txt);font-size:13px;min-width:0;font-family:Menlo,Monaco,monospace}
#file-in:focus{outline:none;border-color:var(--blu)}
.btn{border:none;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
#btn-load{background:var(--bdr);color:var(--txt)}
#btn-load:hover{background:#475569}
#btn-run{background:var(--grn);color:#000}
#btn-run:hover:not(:disabled){background:#16a34a}
#btn-run:disabled{background:var(--bdr);color:#64748b;cursor:not-allowed}
#main{flex:1;display:grid;grid-template-columns:1fr 340px;overflow:hidden;min-height:0}
#graph{overflow:auto;background:var(--bg);position:relative}
#dag-svg{display:block;min-width:100%;min-height:100%}
#g-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:13px;pointer-events:none}
#rp{background:var(--sur);border-left:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden}
.sec{padding:14px;border-bottom:1px solid var(--bdr)}
.sec-t{font-size:11px;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.field{margin-bottom:8px}
.field label{display:block;font-size:12px;color:var(--mut);margin-bottom:4px}
.field textarea,.field input[type=text]{width:100%;background:var(--bg);border:1px solid var(--bdr);border-radius:4px;padding:6px 8px;color:var(--txt);font-size:13px;font-family:inherit;resize:vertical}
.field textarea{height:76px}
.field textarea:focus,.field input:focus{outline:none;border-color:var(--blu)}
#log-sec{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
#log-sec .sec-t{padding:12px 14px 0;flex-shrink:0}
#log-scroll{flex:1;overflow-y:auto;padding:6px 14px}
.ll{font-size:12px;font-family:Menlo,Monaco,Consolas,monospace;padding:2px 0;color:var(--mut);display:flex;gap:6px}
.ll .ts{color:#475569;flex-shrink:0}
.ll.run{color:#93c5fd}
.ll.ok{color:#86efac}
.ll.err{color:#fca5a5}
.ll.done{color:var(--txt);font-weight:600}
#res-sec{padding:12px 14px;border-top:1px solid var(--bdr);flex-shrink:0;display:flex;flex-direction:column;max-height:190px}
#res-sec .sec-t{margin-bottom:8px}
#res-pre{background:var(--bg);border:1px solid var(--bdr);border-radius:6px;padding:8px 10px;font-size:12px;font-family:Menlo,Monaco,Consolas,monospace;color:#86efac;white-space:pre-wrap;word-break:break-all;flex:1;overflow-y:auto;min-height:40px}
</style>
</head>
<body>
<div id="hdr">
  <span id="logo">&#x2B21; DAG Studio</span>
  <input id="file-in" type="text" placeholder="path/to/workflow.dag.json" spellcheck="false"/>
  <button class="btn" id="btn-load">Load</button>
  <button class="btn" id="btn-run" disabled>&#x25B6; Run</button>
</div>
<div id="main">
  <div id="graph">
    <svg id="dag-svg"></svg>
    <div id="g-empty">Enter a DAG file path above and click Load</div>
  </div>
  <div id="rp">
    <div class="sec">
      <div class="sec-t">Inputs</div>
      <div id="inp-form"></div>
    </div>
    <div id="log-sec">
      <div class="sec-t" style="padding:12px 14px 0">Execution Log</div>
      <div id="log-scroll"></div>
    </div>
    <div id="res-sec">
      <div class="sec-t">Result</div>
      <pre id="res-pre"></pre>
    </div>
    <div id="node-detail" style="display:none;padding:10px 14px;border-top:1px solid var(--bdr);font-size:12px;flex-shrink:0;max-height:120px;overflow-y:auto"></div>
  </div>
</div>

<script>
var NW=160,NH=56;
var C={
  pending:{bg:'#1e293b',st:'#334155',tx:'#94a3b8',ic:''},
  running:{bg:'#1e3a8a',st:'#3b82f6',tx:'#93c5fd',ic:'> '},
  success:{bg:'#14532d',st:'#22c55e',tx:'#86efac',ic:'v '},
  failed: {bg:'#450a0a',st:'#ef4444',tx:'#fca5a5',ic:'x '}
};
var dag=null,ns={},pos={},busy=false,mfts=[];
// RAF-based event queue: process one event per animation frame so the browser repaints between each node state change.
var _evQ=[];
function _drain(){
  if(!_evQ.length)return;
  var item=_evQ.shift();
  if(typeof item==='function'){item();}else{onEv(item);}
  if(_evQ.length)requestAnimationFrame(_drain);
}
function pushEv(ev){_evQ.push(ev);if(_evQ.length===1)requestAnimationFrame(_drain);}
function pushCb(fn){_evQ.push(fn);if(_evQ.length===1)requestAnimationFrame(_drain);}

function gid(id){return document.getElementById(id);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ts(){return new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});}

function addLog(type,msg){
  var d=document.createElement('div');
  d.className='ll '+type;
  d.innerHTML='<span class="ts">'+ts()+'</span><span>'+esc(msg)+'</span>';
  var s=gid('log-scroll');
  s.appendChild(d);
  s.scrollTop=s.scrollHeight;
}

function calcPos(nodes){
  if(nodes.every(function(n){return n.position&&n.position.x!=null;})){
    var p={};
    nodes.forEach(function(n){p[n.nodeId]={x:n.position.x,y:n.position.y};});
    return p;
  }
  var depth={};
  var changed=true;
  while(changed){
    changed=false;
    nodes.forEach(function(n){
      if(depth[n.nodeId]!=null)return;
      var deps=n.dependsOn||[];
      if(deps.length===0){depth[n.nodeId]=0;changed=true;return;}
      var dd=deps.map(function(d){return depth[d];});
      if(dd.every(function(d){return d!=null;})){
        depth[n.nodeId]=Math.max.apply(null,dd)+1;changed=true;
      }
    });
    nodes.forEach(function(n){if(depth[n.nodeId]==null){depth[n.nodeId]=0;changed=true;}});
  }
  var byD={};
  nodes.forEach(function(n){var d=depth[n.nodeId]||0;if(!byD[d])byD[d]=[];byD[d].push(n);});
  var p={};
  Object.keys(byD).sort(function(a,b){return +a-+b;}).forEach(function(d){
    byD[d].forEach(function(n,i){p[n.nodeId]={x:+d*250+60,y:i*110+60};});
  });
  return p;
}

function render(){
  if(!dag)return;
  gid('g-empty').style.display='none';
  var svg=gid('dag-svg');
  var xs=Object.keys(pos).map(function(k){return pos[k].x;});
  var ys=Object.keys(pos).map(function(k){return pos[k].y;});
  var W=Math.max.apply(null,xs)+NW+70,H=Math.max.apply(null,ys)+NH+70;
  svg.setAttribute('width',W);
  svg.setAttribute('height',H);
  svg.setAttribute('viewBox','0 0 '+W+' '+H);

  var h='<defs><marker id="arr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="#475569"/></marker></defs>';

  dag.edges.forEach(function(e){
    var sp=pos[e.from],tp=pos[e.to];
    if(!sp||!tp)return;
    var sx=sp.x+NW,sy=sp.y+NH/2,tx=tp.x,ty=tp.y+NH/2,cx=(sx+tx)/2;
    h+='<path d="M'+sx+','+sy+' C'+cx+','+sy+' '+cx+','+ty+' '+tx+','+ty+'" stroke="#475569" stroke-width="2" fill="none" marker-end="url(#arr)"/>';
    if(e.bindings&&e.bindings.length>0){
      var b=e.bindings[0];
      var label=b.outputKey===b.inputKey?b.outputKey:(b.outputKey+'→'+b.inputKey);
      var mx=(sx+tx)/2,my=(sy+ty)/2;
      h+='<text x="'+mx+'" y="'+(my-4)+'" text-anchor="middle" fill="#64748b" font-size="9" font-family="Menlo,monospace">'+esc(label)+'</text>';
    }
  });

  var TYPE_COLORS={string:'#3b82f6',object:'#f59e0b',binary:'#8b5cf6'};
  dag.nodes.forEach(function(n){
    var p=pos[n.nodeId];if(!p)return;
    var st=ns[n.nodeId]||'pending',c=C[st]||C.pending;
    h+='<rect x="'+p.x+'" y="'+p.y+'" width="'+NW+'" height="'+NH+'" rx="8" fill="'+c.bg+'" stroke="'+c.st+'" stroke-width="1.5" data-nid="'+esc(n.nodeId)+'" style="cursor:pointer" onclick="showNodeDetail(this.dataset.nid)" />';
    h+='<text x="'+(p.x+NW/2)+'" y="'+(p.y+24)+'" text-anchor="middle" fill="'+c.tx+'" font-size="13" font-weight="600" font-family="system-ui" style="pointer-events:none">'+esc(c.ic+n.nodeId)+'</text>';
    h+='<text x="'+(p.x+NW/2)+'" y="'+(p.y+41)+'" text-anchor="middle" fill="'+c.tx+'" font-size="10" opacity=".65" font-family="Menlo,monospace" style="pointer-events:none">'+esc(n.nodeType)+'</text>';
    var mft=mfts.find(function(m){return m.nodeType===n.nodeType;});
    if(mft){
      if(mft.inputs){
        mft.inputs.forEach(function(port,i){
          var cy=p.y+20+i*10;
          if(cy>p.y+NH-8)return;
          var col=TYPE_COLORS[port.type]||'#6b7280';
          h+='<circle cx="'+p.x+'" cy="'+cy+'" r="3" fill="'+col+'"><title>'+esc(port.key)+': '+esc(port.type)+'</title></circle>';
        });
      }
      if(mft.outputs){
        mft.outputs.forEach(function(port,i){
          var cy=p.y+20+i*10;
          if(cy>p.y+NH-8)return;
          var col=TYPE_COLORS[port.type]||'#6b7280';
          h+='<circle cx="'+(p.x+NW)+'" cy="'+cy+'" r="3" fill="'+col+'"><title>'+esc(port.key)+': '+esc(port.type)+'</title></circle>';
        });
      }
    }
  });

  svg.innerHTML=h;
}

function buildForm(){
  var f=gid('inp-form');f.innerHTML='';
  if(!dag)return;
  var miNode=dag.nodes.find(function(n){return n.nodeType==='multi-input';});
  if(miNode){
    var ports=(miNode.config&&Array.isArray(miNode.config.ports)&&miNode.config.ports.length>0)
      ?miNode.config.ports:['text'];
    ports.forEach(function(key){
      var d=document.createElement('div');d.className='field';
      d.innerHTML='<label>'+esc(key)+'</label><textarea data-key="'+esc(key)+'" placeholder="Enter '+esc(key)+'..."></textarea>';
      f.appendChild(d);
    });
    return;
  }
  if(!dag.nodes.some(function(n){return n.nodeType==='input';}))return;
  var d=document.createElement('div');d.className='field';
  d.innerHTML='<label>text</label><textarea data-key="text" placeholder="Enter input text..."></textarea>';
  f.appendChild(d);
}

function loadDag(file){
  if(!file)return;
  fetch('/api/dag?file='+encodeURIComponent(file))
    .then(function(r){return r.json();})
    .then(function(data){
      if(data.error){addLog('err','Error: '+data.error);return;}
      dag=data;ns={};mfts=data._manifests||[];
      dag.nodes.forEach(function(n){ns[n.nodeId]='pending';});
      pos=calcPos(dag.nodes);
      render();buildForm();
      gid('btn-run').disabled=false;
      addLog('ok','Loaded: '+file+' ('+dag.nodes.length+' nodes)');
    })
    .catch(function(e){ // allow-fallback: load errors are shown to the user in the log panel
      addLog('err','Load failed: '+e.message);
    });
}

function onEv(ev){
  if(ev.type==='task.started'){
    ns[ev.nodeId]='running';render();
    addLog('run','> '+ev.nodeId);
  }else if(ev.type==='task.completed'){
    ns[ev.nodeId]='success';render();
    addLog('ok','v '+ev.nodeId+(ev.durationMs!=null?' ('+ev.durationMs+'ms)':''));
  }else if(ev.type==='task.failed'){
    ns[ev.nodeId]='failed';render();
    addLog('err','x '+ev.nodeId+(ev.errorMessage?': '+ev.errorMessage:''));
  }else if(ev.type==='final'){
    if(ev.output!=null)gid('res-pre').textContent=String(ev.output);
    addLog('done','Completed in '+ev.durationMs+'ms');
  }else if(ev.type==='error'){
    addLog('err',ev.message);
  }
}

function showNodeDetail(nodeId){
  if(!dag)return;
  var n=dag.nodes.find(function(x){return x.nodeId===nodeId;});
  if(!n)return;
  var mft=mfts.find(function(m){return m.nodeType===n.nodeType;});
  var d=gid('node-detail');
  if(!d)return;
  var html='<b>'+esc(n.nodeId)+'</b> <span style="color:var(--mut)">('+esc(n.nodeType)+')</span>';
  if(mft){
    if(mft.inputs&&mft.inputs.length){
      html+='<div style="margin-top:6px;font-size:11px;color:var(--mut)">Inputs: '+
        mft.inputs.map(function(p){return esc(p.key)+'<span style="color:#64748b">:'+esc(p.type)+'</span>';}).join(', ')+'</div>';
    }
    if(mft.outputs&&mft.outputs.length){
      html+='<div style="font-size:11px;color:var(--mut)">Outputs: '+
        mft.outputs.map(function(p){return esc(p.key)+'<span style="color:#64748b">:'+esc(p.type)+'</span>';}).join(', ')+'</div>';
    }
  }
  if(n.config&&Object.keys(n.config).length){
    html+='<div style="margin-top:4px;font-size:11px;color:var(--mut)">Config: '+
      Object.keys(n.config).map(function(k){return esc(k)+'='+esc(String(n.config[k]));}).join(', ')+'</div>';
  }
  d.innerHTML=html;
  d.style.display='block';
}

async function runDag(){
  if(!dag||busy)return;
  var file=gid('file-in').value.trim();
  var inputs={};
  document.querySelectorAll('#inp-form [data-key]').forEach(function(el){
    if(el.dataset.key&&el.value)inputs[el.dataset.key]=el.value;
  });
  busy=true;gid('btn-run').disabled=true;
  gid('log-scroll').innerHTML='';gid('res-pre').textContent='';
  dag.nodes.forEach(function(n){ns[n.nodeId]='pending';});
  render();addLog('','Starting run...');

  try { // allow-fallback: validate errors are logged but do not block the run
    var vr=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:file})});
    var vdata=await vr.json();
    if(vdata.errors&&vdata.errors.length>0){
      vdata.errors.forEach(function(e){addLog('err','Validate: '+e.message);});
      pushCb(function(){busy=false;gid('btn-run').disabled=false;});
      return;
    }
    if(vdata.warnings&&vdata.warnings.length>0){
      vdata.warnings.forEach(function(w){addLog('run','Warning: '+w.message);});
    }
  } catch(ve){ // allow-fallback: validate endpoint failure is logged but does not block the run
    addLog('run','Validation skipped: '+ve.message);
  }

  try { // allow-fallback: run errors are shown to the user in the log panel
    var r=await fetch('/api/run',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file:file,inputs:inputs})
    });
    if(!r.ok||!r.body)throw new Error('Server error '+r.status);
    var reader=r.body.getReader(),dec=new TextDecoder(),buf='';
    for(;;){
      var chunk=await reader.read();
      if(chunk.done)break;
      buf+=dec.decode(chunk.value,{stream:true});
      var parts=buf.split('\\n\\n');buf=parts.pop()||'';
      for(var i=0;i<parts.length;i++){
        var lines=parts[i].split('\\n');
        for(var j=0;j<lines.length;j++){
          if(!lines[j].startsWith('data: '))continue;
          var ev=null;
          try{ev=JSON.parse(lines[j].slice(6));}catch(pe){ // allow-fallback: malformed SSE line is silently skipped
            continue;
          }
          if(ev)pushEv(ev);
        }
      }
    }
  } catch(e){ // allow-fallback: run errors are displayed in the log panel; does not crash the UI
    addLog('err',e.message);
  } finally {
    pushCb(function(){busy=false;gid('btn-run').disabled=false;});
  }
}

var initFile=new URLSearchParams(location.search).get('file')||'';
if(initFile){gid('file-in').value=initFile;loadDag(initFile);}

gid('btn-load').addEventListener('click',function(){
  var f=gid('file-in').value.trim();
  if(f){history.replaceState({},'','?file='+encodeURIComponent(f));loadDag(f);}
});
gid('file-in').addEventListener('keydown',function(e){if(e.key==='Enter')gid('btn-load').click();});
gid('btn-run').addEventListener('click',runDag);
</script>
</body>
</html>`;
}
