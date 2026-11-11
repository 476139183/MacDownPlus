#!/usr/bin/env python3
"""Run the real macOS app against an isolated document/config directory."""
import json, os, pathlib, plistlib, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
app = root / 'target/aarch64-apple-darwin/release/bundle/macos/MacDown Rust.app/Contents/MacOS/macdown-rust'
with tempfile.TemporaryDirectory(prefix='macdown-native-') as folder:
    directory = pathlib.Path(folder)
    bundle=directory/'PlugIns/Smoke.bundle/Contents'
    (bundle/'MacOS').mkdir(parents=True)
    with (bundle/'Info.plist').open('wb') as info:
        plistlib.dump({'CFBundleExecutable':'Smoke','CFBundleIdentifier':'io.github.476139183.macdownrust.smoke','CFBundlePackageType':'BNDL','NSPrincipalClass':'MacDownRustSmokePlugin'},info)
    subprocess.run(['xcrun','clang','-arch','arm64','-fobjc-arc','-bundle','-framework','Cocoa',str(root/'tests/native/SmokePlugin.m'),'-o',str(bundle/'MacOS/Smoke')],check=True,capture_output=True)
    (directory/'preferences.json').write_text(json.dumps({'htmlSyntaxHighlighting': True, 'htmlMermaid': True, 'htmlGraphviz': True}))
    fixture = directory/'fixture.md'
    fixture.write_text('# Hello\n\n```rust\nfn main() {}\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n\n```dot\ndigraph { a -> b }\n```\n' + '\n\n'.join(f'Paragraph {i}: pagination and original paper settings.' for i in range(90)) + '\n\nEND OF DOCUMENT\n')
    drafts=directory/'Drafts'
    drafts.mkdir()
    (drafts/'doc-7.json').write_text(json.dumps({'path':str(fixture),'saved':fixture.read_text(),'text':fixture.read_text()+'\nRECOVERED DRAFT\n'}))
    env = {**os.environ, 'MACDOWN_TEST_DIR': folder}
    run = subprocess.run([str(app), str(fixture)], env=env, timeout=50, capture_output=True, text=True)
    report = directory/'report.json'
    if not report.exists():
        raise SystemExit(f'No native report. Exit={run.returncode}\n{run.stdout}\n{run.stderr}')
    results = json.loads(report.read_text())
    if not results.get('passed'): print(run.stdout, run.stderr)
    results['draftRecovery']='RECOVERED DRAFT' in fixture.read_text() and not (drafts/'doc-7.json').exists()
    results['savedOnDisk'] = 'Saved from WKWebView.' in fixture.read_text()
    pdf = directory/'preview.pdf'
    results['pdfOnDisk'] = pdf.exists() and pdf.read_bytes().startswith(b'%PDF-') and pdf.stat().st_size > 1000
    results['pluginProtocol']=(directory/'plugin-init.txt').exists() and (directory/'plugin-run.txt').exists()
    results['pagination']=results.get('pdfSummary',{}).get('pages',0)>1 and results.get('pdfSummary',{}).get('containsEnd',False)
    print(json.dumps(results, indent=2, ensure_ascii=False))
    output = root/'docs/parity/native-smoke.json'
    output.write_text(json.dumps(results, indent=2, ensure_ascii=False)+'\n')
    raise SystemExit(0 if results.get('passed') and results['savedOnDisk'] and results['pdfOnDisk'] and results['pluginProtocol'] and results['pagination'] and results['draftRecovery'] else 1)
