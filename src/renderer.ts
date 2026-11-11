export type Preferences = Record<string, any>;
const cache = new Map<string, Promise<string>>();
function asset(path: string) {
  let value = cache.get(path);
  if (!value) {
    value = fetch(path).then((r) => {
      if (!r.ok) throw Error(`Missing resource: ${path}`);
      return r.text();
    });
    cache.set(path, value);
  }
  return value;
}
const safeScript = (s: string) => s.replace(/<\/script/gi, "<\\/script");
export async function decorate(
  html: string,
  content: string,
  p: Preferences,
  token: string,
): Promise<string> {
  const scripts: string[] = [],
    styles: string[] = [];
  if (p.htmlSyntaxHighlighting) {
    scripts.push(await asset("/vendor/prism/components/prism-core.min.js"));
    const meta = JSON.parse(
      await asset("/vendor/prism/components.json"),
    ).languages;
    const wanted = [...content.matchAll(/^\s*```\s*([\w+-]+)/gm)].map(
      (x) => x[1],
    );
    const seen = new Set<string>();
    async function language(name: string) {
      const alias = Object.keys(meta).find((k) =>
        [meta[k].alias].flat().includes(name),
      );
      name = meta[name] ? name : alias || name;
      if (seen.has(name) || !meta[name]) return;
      seen.add(name);
      for (const required of [meta[name].require || []].flat())
        await language(required);
      scripts.push(
        await asset(`/vendor/prism/components/prism-${name}.min.js`),
      );
    }
    for (const name of ["markup", "css", "clike", "javascript", ...wanted])
      await language(name);
    const theme = /^prism(?:-[\w-]+)?$/.test(p.htmlHighlightingThemeName)
      ? p.htmlHighlightingThemeName
      : "prism";
    styles.push(await asset(`/vendor/prism/themes/${theme}.css`));
    if (p.htmlLineNumbers) {
      scripts.push(
        await asset(
          "/vendor/prism/plugins/line-numbers/prism-line-numbers.min.js",
        ),
      );
      styles.push(
        await asset(
          "/vendor/prism/plugins/line-numbers/prism-line-numbers.css",
        ),
      );
    }
    if (p.htmlCodeBlockAccessory === 1) {
      scripts.push(
        await asset(
          "/vendor/prism/plugins/show-language/prism-show-language.min.js",
        ),
      );
      styles.push(
        await asset("/vendor/macdown/Extensions/show-information.css"),
      );
    }
    scripts.push("Prism.highlightAll();");
  }
  if (p.htmlTaskList)
    scripts.push(await asset("/vendor/macdown/Extensions/tasklist.js"));
  if (p.htmlCodeBlockAccessory === 2)
    styles.push(await asset("/vendor/macdown/Extensions/show-information.css"));
  if (p.htmlMermaid) {
    scripts.push(
      await asset("/vendor/macdown/Extensions/mermaid.min.js"),
      await asset("/vendor/macdown/Extensions/mermaid.init.js"),
    );
    styles.push(await asset("/vendor/macdown/Extensions/mermaid.forest.css"));
  }
  if (p.htmlGraphviz)
    scripts.push(
      await asset("/vendor/macdown/Extensions/viz.js"),
      await asset("/vendor/macdown/Extensions/viz.init.js"),
    );
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https:; img-src data: https: http:; font-src data: https:; connect-src https:; object-src 'none'; base-uri 'none'`;
  html = html.replace(
    /<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i,
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  );
  html = html.replace(
    "</head>",
    () => `<style data-highlight>${styles.join("\n")}</style></head>`,
  );
  const bridge = `(()=>{const token=${JSON.stringify(token)};const send=(type,data={})=>parent.postMessage({token,type,...data},'*');let muted=0;const ratio=()=>scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight);addEventListener('scroll',()=>{if(Date.now()>muted)send('scroll',{ratio:ratio()})});addEventListener('message',e=>{if(e.source!==parent||e.data.token!==token)return;if(e.data.type==='scroll'){muted=Date.now()+150;scrollTo(0,e.data.ratio*Math.max(0,document.documentElement.scrollHeight-innerHeight));}if(e.data.type==='snapshot')send('snapshot',{html:'<!doctype html>'+document.documentElement.outerHTML});});addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a');if(!a)return;const href=a.getAttribute('href');if(href&&href.startsWith('#'))return;e.preventDefault();if(href)send('link',{href});});addEventListener('load',()=>{const done=()=>send('ready');if(window.MathJax&&MathJax.Hub)MathJax.Hub.Queue(done);else done();});})();`;
  let math = "";
  if (p.htmlMathJax) {
    scripts.push(
      `window.MathJax={tex2jax:{inlineMath:${p.htmlMathJaxInlineDollar ? "[['$','$'],['\\\\(','\\\\)']]" : "[['\\\\(','\\\\)']]"},processEscapes:true},showMathMenu:false};`,
    );
    math = `<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.3/MathJax.js?config=TeX-AMS_SVG"></script>`;
  }
  return html.replace(
    "</body>",
    () =>
      `<script nonce="${nonce}">${safeScript(scripts.join("\n;\n"))}</script>${math}<script nonce="${nonce}">${safeScript(bridge)}</script></body>`,
  );
}
export function exportedHTML(
  html: string,
  includeStyle = true,
  includeHighlight = true,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll('script,meta[http-equiv="Content-Security-Policy"]')
    .forEach((x) => x.remove());
  if (!includeStyle)
    doc
      .querySelectorAll("style:not([data-highlight])")
      .forEach((x) => x.remove());
  if (!includeHighlight)
    doc.querySelectorAll("style[data-highlight]").forEach((x) => x.remove());
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}
