#!/usr/bin/env python3
"""Regenerate catalogs offline from the frozen upstream .strings and UI additions."""
from pathlib import Path
import json, re, plistlib
root=Path(__file__).resolve().parents[1]
base=root/'third-party/macdown/Localization'
quote=r'"(?:\\.|[^"\\])*"'
entry=re.compile(r'(?P<comments>(?:/\*.*?\*/\s*)*)(?P<key>'+quote+r')\s*=\s*(?P<value>'+quote+r')\s*;',re.S)
def decode(raw):
 try:return json.loads(raw.replace('\\U','\\u'))
 except:return raw[1:-1]
out=root/'src/locales';out.mkdir(parents=True,exist_ok=True)
for directory in sorted(base.glob('*.lproj')):
 locale=directory.stem;menu={};messages={}
 for path in directory.glob('*.strings'):
  data=path.read_bytes();text=data.decode('utf-16') if data.startswith((b'\xff\xfe',b'\xfe\xff')) else data.decode('utf-8-sig')
  for m in entry.finditer(text):
   key=decode(m['key']);value=decode(m['value']);comment=m['comments'];title=re.search(r'title = ('+quote+r')',comment)
   if path.name=='MainMenu.strings' and key.endswith('.title'):menu[key.removesuffix('.title')]=value.replace('MacDown','MacDownPlus')
   if title:messages[decode(title.group(1))]=value
   if path.name=='Localizable.strings':messages[key]=value
 (out/f'{locale}.json').write_text(json.dumps({'locale':locale,'menu':menu,'messages':messages},ensure_ascii=False,indent=2)+'\n')
aliases={
'Theme':'Theme:','Font':'Base font:','Line spacing':'Line spacing:','Editor on the right':'Put editor on the right','Synchronize scrolling':'Sync preview scrollbar when editor scrolls','Limit editor width':'Limit editor width to','Show word count':'Show word count','Automatically increment numbered lists':'Auto-increment numbering in ordered lists','Continue list and blockquote prefixes':'Automatically insert line prefix for the current block','Complete matching characters':'Auto-complete matching characters','Ensure newline at end of file':'Ensure newline at end of file on save','Emphasis inside words':'Intra-word emphasis','Tables':'Table','Fenced code blocks':'Fenced code block','Footnotes':'Footnote','Autolinks':'Autolink','Task lists':'Task list syntax','Render table of contents':'Detect table of contents token','Hard wrapping':'Render newline literally','Syntax highlighting':'Syntax highlighted code block','Zoom relative to base font size':'Scale preview based on editor font size','Create files when following links to missing documents':'Automatically create files for link targets','Preferences':'Preferences…','Include styles':'Include styles','Include syntax highlighting':'Include syntax highlighting'}
rows='''
Cancel|取消|取消
Close|关闭|關閉
Save|保存|儲存
Don't Save|不保存|不要儲存
Revert|恢复|回復
Revert to Saved?|恢复到上次保存？|回復至上次儲存？
All changes since the last save will be lost.|上次保存后的所有修改将丢失。|上次儲存後的所有修改將會遺失。
Save changes to “{name}”?|要保存对“{name}”的修改吗？|要儲存對「{name}」的修改嗎？
Your changes will be lost if you do not save them.|如果不保存，你的修改将会丢失。|如果不儲存，你的修改將會遺失。
Export|导出|輸出
Export HTML|导出 HTML|輸出 HTML
Include styles|包含样式|包含樣式
Do not open an untitled document on launch|启动时不打开未命名文档|啟動時不要打開未命名文件
Include pre-release versions when checking for updates|检查更新时包括预发布版本|檢查更新時包含預先發行版本
Horizontal inset|水平内边距|水平內邊距
Vertical inset|垂直内边距|垂直內邊距
Maximum width|最大宽度|最大寬度
Count|统计方式|統計方式
Words|字词|字詞
Characters|字符|字元
Characters without whitespace|不含空白的字符|不含空白的字元
Scroll past the end|允许滚动超过文末|允許捲動超過文件結尾
Convert tabs to spaces|将制表符转换为空格|將定位字元轉換為空格
Smart Home key|智能 Home 键|智慧 Home 鍵
Unordered list marker|无序列表标记|無序清單標記
Render Markdown manually|手动渲染 Markdown|手動算繪 Markdown
Smart punctuation|智能标点|智慧標點
Detect YAML front matter|检测 YAML 前置信息|偵測 YAML 前置資訊
Render equations with MathJax (internet required)|使用 MathJax 渲染公式（需要联网）|使用 MathJax 算繪公式（需要網路）
Use single dollar signs for inline math|使用单个美元符号标记行内公式|使用單個美元符號標記行內公式
Highlighting theme|语法高亮主题|語法突顯主題
Code block line numbers|显示代码块行号|顯示程式碼區塊行號
Code block accessory|代码块附加信息|程式碼區塊附加資訊
Language name|语言名称|語言名稱
Custom information|自定义信息|自訂資訊
Render Graphviz diagrams|渲染 Graphviz 图表|算繪 Graphviz 圖表
Render Mermaid diagrams|渲染 Mermaid 图表|算繪 Mermaid 圖表
Default directory for local resources|本地资源默认目录|本機資源預設目錄
Changes are saved automatically.|设置自动保存。|設定會自動儲存。
Install Command Line Tool…|安装命令行工具…|安裝命令列工具⋯
Installed: {path}|已安装：{path}|已安裝：{path}
Choose…|选择…|選擇⋯
Font family|字体|字體
Font size|字号|字級
Open Themes Folder…|打开主题文件夹…|打開主題檔案夾⋯
Open Styles Folder…|打开样式文件夹…|打開樣式檔案夾⋯
Open Templates Folder…|打开模板文件夹…|打開範本檔案夾⋯
Formatting|格式工具栏|格式工具列
Markdown editor|Markdown 编辑器|Markdown 編輯器
Resize panes|调整分栏大小|調整分欄大小
Markdown preview|Markdown 预览|Markdown 預覽
Mark|高亮|突顯
Code|代码|程式碼
Comment|注释|註解
Render|渲染|算繪
Default|默认|預設
Untitled|未命名|未命名
Untitled.md|未命名.md|未命名.md
Manage Plug-ins…|管理插件…|管理外掛⋯
Printing was cancelled or failed.|打印已取消或失败。|列印已取消或失敗。
New release available|有新版本可用|有新版本可用
View Release|查看版本|檢視版本
You are running the latest published version.|你正在使用最新的已发布版本。|你正在使用最新的已發行版本。
No releases have been published yet.|目前还没有已发布版本。|目前尚無已發行版本。
Unable to check releases ({status}).|无法检查更新（{status}）。|無法檢查更新（{status}）。
{count} words|{count} 个字词|{count} 個字詞
{count} characters|{count} 个字符|{count} 個字元
Find|查找|尋找
Replace|替换|取代
next|下一个|下一個
previous|上一个|上一個
all|全部|全部
match case|区分大小写|區分大小寫
regexp|正则表达式|正規表示式
by word|全词匹配|全字比對
replace|替换|取代
replace all|全部替换|全部取代
close|关闭|關閉
Go to line|跳转到行|移至行號
go|跳转|移至
current match|当前匹配|目前相符項目
on line|所在行|位於行
replaced match on line $|已替换第 $ 行的匹配|已取代第 $ 行的相符項目
replaced $ matches|已替换 $ 处匹配|已取代 $ 處相符項目
'''
# New messages complement upstream strings; existing upstream translations win for original labels.
extra={}
for line in rows.strip().splitlines():
 key,hans,hant=line.split('|');extra[key]={'zh-Hans':hans,'zh-Hant':hant}
extra['Open documents from Terminal: macdownplus README.md\nRead standard input: cat README.md | macdownplus -\nInstall into a directory included in your PATH. The tool launches this copy of the application.']={'zh-Hans':'从终端打开文档：macdownplus README.md\n读取标准输入：cat README.md | macdownplus -\n安装到 PATH 包含的目录。工具会启动当前安装的应用。','zh-Hant':'從終端機打開文件：macdownplus README.md\n讀取標準輸入：cat README.md | macdownplus -\n請安裝至 PATH 包含的目錄。工具會啟動目前安裝的應用程式。'}
about='Markdown editor built with Rust + Tauri.\nBased on MacDown by Tzu-ping Chung.\nMacDown: https://github.com/MacDownApp/macdown\nMIT license; complete third-party notices are included with the source distribution.'
extra[about]={'zh-Hans':'Markdown 编辑器，基于 Tzu-ping Chung 的 MacDown。\n感谢原项目：https://github.com/MacDownApp/macdown\n采用 MIT 许可证，完整第三方声明随源代码和应用提供。','zh-Hant':'Markdown 編輯器，基於 Tzu-ping Chung 的 MacDown。\n感謝原專案：https://github.com/MacDownApp/macdown\n採用 MIT 授權，完整第三方聲明隨原始碼及應用程式提供。'}
native={'选择命令行工具安装目录':('Choose command-line tool installation directory','選擇命令列工具安裝目錄'),'打开文档失败':('Unable to Open Document','無法打開文件'),'无法打开 {path}：{error}':('Unable to open {path}: {error}','無法打開 {path}：{error}'),'原文件已移动或删除，请另存为。':('The original file was moved or deleted. Please use Save As.','原始檔案已移動或刪除，請另存新檔。'),'文件已被其他程序修改。请另存为，避免覆盖外部改动。':('Another application modified the file. Please use Save As to preserve those changes.','檔案已被其他程式修改。請另存新檔，避免覆寫外部變更。'),'文档又有新修改，已保留窗口，请重新确认关闭。':('The document has new changes. The window remains open; please confirm closing again.','文件又有新修改，已保留視窗，請重新確認關閉。'),'当前文档尚未保存':('This document has not been saved yet.','目前文件尚未儲存'),'不能用导出文件覆盖当前 Markdown 文档':('The export cannot overwrite the current Markdown document.','輸出檔案不能覆寫目前的 Markdown 文件'),'文档已关闭':('The document is closed.','文件已關閉'),'预览内容已变化，请重新导出。':('The preview changed. Please export again.','預覽內容已變更，請重新輸出。'),'预览未响应，请重试。':('The preview did not respond. Please try again.','預覽未回應，請重試。'),'预览仍在渲染，请稍后重试。':('The preview is still rendering. Please try again shortly.','預覽仍在算繪，請稍後重試。')}
menu_source=json.loads((root/'src-tauri/resources/menu.json').read_text())
def items(entries):
 for e in entries:
  if e.get('action'):yield e
  yield from items(e.get('children') or [])
for path in sorted(out.glob('*.json')):
 j=json.loads(path.read_text());lang=j['locale'];messages=j['messages']
 for alias,original in aliases.items():
  if original in messages:messages.setdefault(alias,messages[original].rstrip(':：'))
 for key,translations in extra.items():
  if lang in translations:messages.setdefault(key,translations[lang])
 for key,(en,hant) in native.items():
  if lang=='en':messages[key]=en
  elif lang=='zh-Hant':messages[key]=hant
  elif lang=='zh-Hans':messages[key]=key
 for e in items(menu_source):messages[e['action']]=j['menu'].get(e['id'],e['title'])
 path.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
plist={'CFBundleDevelopmentRegion':'en','CFBundleLocalizations':[p.stem for p in sorted(out.glob('*.json'))]}
with (root/'src-tauri/Info.plist').open('wb') as f:plistlib.dump(plist,f)
(root/'docs/parity/localization-provenance.json').write_text(json.dumps({'upstream':'MacDownApp/macdown','commit':'3e2a2bf101c215c143bf00d9f857965f0ee82487','catalogs':plist['CFBundleLocalizations'],'new_ui_fully_completed':['en','zh-Hans','zh-Hant'],'other_locales':'Reuse upstream strings; untranslated new UI falls back to English.'},indent=2)+'\n')
print('Localized catalogs:',len(plist['CFBundleLocalizations']))

for code, additions in {
 'zh-Hans': {'Template':'模板','Style':'样式'},
 'zh-Hant': {'Template':'範本','Style':'樣式','Emphasis inside words':'單字內強調','Task lists':'工作清單語法','Hard wrapping':'換行直接斷行','Render table of contents':'偵測目錄標記'},
}.items():
 path=out/f'{code}.json'; data=json.loads(path.read_text()); data['messages'].update(additions);path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

color_ui={
 'Text color':('文字颜色','文字顏色'), 'Background color':('背景颜色','背景顏色'), 'Clear colors':('清除颜色','清除顏色'),
 'textColor':('文字颜色','文字顏色'), 'backgroundColor':('背景颜色','背景顏色'), 'clearColors':('清除颜色','清除顏色'),
 'Apply':('应用','套用'), 'Hex color':('十六进制颜色','十六進位顏色'), 'Choose color':('选择颜色','選擇顏色'),
 'Select text to format.':('请先选中要设置格式的文字。','請先選取要設定格式的文字。'),
 'Enter a color such as #c62828.':('请输入颜色，例如 #c62828。','請輸入顏色，例如 #c62828。'),
}
for path in out.glob('*.json'):
 data=json.loads(path.read_text());code=data['locale']
 for key,(hans,hant) in color_ui.items():
  if code in ('en','zh-Hans','zh-Hant'):data['messages'][key]=hans if code=='zh-Hans' else hant if code=='zh-Hant' else key
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
