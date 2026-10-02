"""Unknown-effect retry guard with an unsafe in-memory negative control; no cloud resources."""
import argparse
import base64, importlib.util, json, multiprocessing, secrets, socket, tempfile, time, types, uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
path=Path(__file__).with_name('organization-broker.py')
spec=importlib.util.spec_from_file_location('broker_guard',path)
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
removed="            elif not provider_idempotent:\n                raise Deny('external-reconciliation-required', 503)\n"
source=path.read_text();assert source.count(removed)==1
old=types.ModuleType('without_guard');exec(compile(source.replace(removed,''),str(path),'exec'),old.__dict__)
ctx=multiprocessing.get_context('fork');records=[]
def ready(port):
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.1):return
        except OSError:time.sleep(.1)
    raise AssertionError('Service not ready')
for name,module,expected_status,expected_count in [('current',b,503,1),('negative-control-without-unknown-guard',old,200,2)]:
    with tempfile.TemporaryDirectory(prefix='issue-2-unknown-') as directory:
        root=Path(directory);b.initialize(root);processes=[]
        issuer=Ed25519PrivateKey.generate();actor=Ed25519PrivateKey.generate();secret=secrets.token_urlsafe(32)
        def signed(payload):return {'payload':payload,'signature':base64.urlsafe_b64encode(issuer.sign(b.canonical(payload))).decode().rstrip('=')}
        grant={'id':'a','actor':'a','actorPublic':actor.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw).hex(),'task':'t','role':'worker','audience':'organization-research-broker','actions':['charge'],'resources':['asset'],'notBefore':int(time.time())-1,'expires':int(time.time())+60,'parent':None,'budget':100,'epoch':1}
        with b.database(root/'broker.db') as db:db.execute('INSERT INTO grants(id,payload) VALUES(?,?)',('a',b.canonical(grant).decode()))
        op={'key':'unknown','action':'charge','task':'t','resource':'asset','amount':5}
        approval=signed({'id':'approval','audience':'organization-research-approval','actor':'a','task':'t','epoch':1,'operationDigest':b.digest(op),'expires':int(time.time())+60})
        def request():
            body={'credential':signed(grant),'operation':op,'approval':approval,'nonce':str(uuid.uuid4())}
            body['proof']=base64.urlsafe_b64encode(actor.sign(b.canonical(body))).decode().rstrip('=')
            try:
                with urlopen(Request('http://127.0.0.1:19191/apply',data=b.canonical(body),headers={'Content-Type':'application/json'}),timeout=3) as r:return r.status
            except HTTPError as e:return e.code
            except Exception:return 0
        def start(crash=None):
            p=ctx.Process(target=module.broker_process,args=(root,19191,19192,secret,issuer.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw).hex(),crash,False));p.start();processes.append(p);ready(19191);return p
        try:
            p=ctx.Process(target=b.effects_process,args=(root,19192,secret,False));p.start();processes.append(p);ready(19192)
            crashed=start('unknown');first=request();crashed.join(5);assert crashed.exitcode==72
            current=start();retry=request()
            with b.database(root/'effects.db') as db:count=db.execute('SELECT COUNT(*) FROM effects').fetchone()[0]
            observed={'id':name,'initialStatus':first,'crashExit':crashed.exitcode,'retryStatus':retry,'externalEffects':count,'passed':first==0 and retry==expected_status and count==expected_count}
            records.append(observed);assert observed['passed']
        finally:
            for p in processes:
                if p.is_alive():p.terminate()
                p.join(5);assert not p.is_alive()
args.output.write_text(json.dumps({'kind':'unknown-outcome-guard-sensitivity','records':records,'limitations':['Local signed HTTP requests; this complements and does not replace the two-guest recovery experiment.','Negative control removes exactly the retry-denial branch in a temporary in-memory module; repository source is unchanged.']},indent=2)+'\n')
print(json.dumps(records))
