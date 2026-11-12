#!/usr/bin/env python3
"""Exercise real LaunchServices cold/warm file-open events without modifying documents."""
import argparse, hashlib, json, pathlib, subprocess, tempfile, time
root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--app',type=pathlib.Path)
parser.add_argument('--document',type=pathlib.Path)
options=parser.parse_args()
product=json.loads((root/'src-tauri/tauri.conf.json').read_text())['productName']
app=options.app or root/f'target/aarch64-apple-darwin/release/bundle/macos/{product}.app'
results=[]
def wait_file(path,log,seconds=20):
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        error=log.read_text(errors='replace') if log.exists() else ''
        if 'state() called before manage()' in error or 'uncaught foreign exception' in error:
            raise AssertionError(error)
        if path.exists(): return json.loads(path.read_text())
        time.sleep(.1)
    raise AssertionError(f'Missing {path.name}; stderr: {error[-1500:]}')
for mode in ['cold','warm']:
    with tempfile.TemporaryDirectory(prefix='macdown-open-events-') as folder:
        work=pathlib.Path(folder)
        document=options.document or work/'中文 空格 文档.md'
        if not options.document:document.write_text('# 打开测试\n\n中文路径与空格。\n',encoding='utf-8')
        expected=hashlib.sha256(document.read_bytes()).hexdigest()
        log=work/'stderr.log'
        command=['open','-n','-a',str(app),'--env',f'MACDOWN_OPEN_TEST_DIR={work}','--stderr',str(log)]
        if mode=='cold':command.append(str(document))
        subprocess.run(command,check=True)
        if mode=='warm':
            wait_file(work/'ready.json',log)
            subprocess.run(['open','-a',str(app),str(document)],check=True)
        report=wait_file(work/'report.json',log)
        assert report['passed'],report
        assert report['sha256']==expected,report
        assert report['windowTitle']==document.name,report
        assert hashlib.sha256(document.read_bytes()).hexdigest()==expected,'Opening changed the source document'
        results.append({'mode':mode,'passed':True,'readOnly':True,'bytes':document.stat().st_size,'locale':report['locale'],'webLocale':report['webLocale'],'editMenu':report['editMenu'],'languageMatches':report['languageMatches']})
        time.sleep(.3)
print(json.dumps(results,ensure_ascii=False,indent=2))
