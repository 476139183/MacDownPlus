import { setLanguage, t } from "./i18n";
import { applicationActions, applicationAction } from "./application";
import { notify } from "./dialogs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Preferences } from "./renderer";
type Row = [string, string, string[]?];
const groups: Record<string, Row[]> = {
  General: [
    [
      "supressesUntitledDocumentOnLaunch",
      "Do not open an untitled document on launch",
    ],
    [
      "createFileForLinkTarget",
      "Create files when following links to missing documents",
    ],
    [
      "updateIncludesPreReleases",
      "Include pre-release versions when checking for updates",
    ],
  ],
  Editor: [
    ["editorStyleName", "Theme"],
    ["editorBaseFontInfo", "Font"],
    ["editorHorizontalInset", "Horizontal inset"],
    ["editorVerticalInset", "Vertical inset"],
    ["editorLineSpacing", "Line spacing"],
    ["editorWidthLimited", "Limit editor width"],
    ["editorMaximumWidth", "Maximum width"],
    ["editorOnRight", "Editor on the right"],
    ["editorShowWordCount", "Show word count"],
    [
      "editorWordCountType",
      "Count",
      ["Words", "Characters", "Characters without whitespace"],
    ],
    ["editorScrollsPastEnd", "Scroll past the end"],
    ["editorEnsuresNewlineAtEndOfFile", "Ensure newline at end of file"],
    [
      "editorAutoIncrementNumberedLists",
      "Automatically increment numbered lists",
    ],
    ["editorInsertPrefixInBlock", "Continue list and blockquote prefixes"],
    ["editorConvertTabs", "Convert tabs to spaces"],
    ["editorCompleteMatchingCharacters", "Complete matching characters"],
    ["editorSyncScrolling", "Synchronize scrolling"],
    ["editorSmartHome", "Smart Home key"],
    ["editorUnorderedListMarkerType", "Unordered list marker", ["*", "-", "+"]],
  ],
  Markdown: [
    ["markdownManualRender", "Render Markdown manually"],
    ["extensionIntraEmphasis", "Emphasis inside words"],
    ["extensionTables", "Tables"],
    ["extensionFencedCode", "Fenced code blocks"],
    ["extensionFootnotes", "Footnotes"],
    ["extensionAutolink", "Autolinks"],
    ["extensionStrikethough", "Strikethrough"],
    ["extensionUnderline", "Underline"],
    ["extensionSuperscript", "Superscript"],
    ["extensionHighlight", "Highlight"],
    ["extensionQuote", "Quote"],
    ["extensionSmartyPants", "Smart punctuation"],
  ],
  HTML: [
    ["htmlTemplateName", "Template"],
    ["htmlStyleName", "Style"],
    ["htmlDetectFrontMatter", "Detect YAML front matter"],
    ["htmlTaskList", "Task lists"],
    ["htmlHardWrap", "Hard wrapping"],
    ["htmlRendersTOC", "Render table of contents"],
    ["htmlMathJax", "Render equations with MathJax (internet required)"],
    ["htmlMathJaxInlineDollar", "Use single dollar signs for inline math"],
    ["htmlSyntaxHighlighting", "Syntax highlighting"],
    [
      "htmlHighlightingThemeName",
      "Highlighting theme",
      [
        "prism",
        "prism-dark",
        "prism-funky",
        "prism-okaidia",
        "prism-twilight",
        "prism-coy",
        "prism-solarizedlight",
        "prism-tomorrow",
      ],
    ],
    ["htmlLineNumbers", "Code block line numbers"],
    [
      "htmlCodeBlockAccessory",
      "Code block accessory",
      ["None", "Language name", "Custom information"],
    ],
    ["htmlGraphviz", "Render Graphviz diagrams"],
    ["htmlMermaid", "Render Mermaid diagrams"],
    ["htmlDefaultDirectoryUrl", "Default directory for local resources"],
    ["previewZoomRelativeToBaseFontSize", "Zoom relative to base font size"],
  ],
  Terminal: [],
};
export async function preferencesUI() {
  const boot = await invoke<{
    locale?: string;
    translations?: Record<string, string>;
    preferences: Preferences;
    resources: Record<string, string[]>;
  }>("bootstrap");
  setLanguage(boot.locale, boot.translations);
  let prefs = boot.preferences,
    tab = "General";
  await listen<string>("menu-action", (event) => {
    if (applicationActions.has(event.payload))
      void applicationAction(event.payload, prefs).catch(notify);
  });
  document.body.classList.add("preferences");
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML =
    '<nav id="pref-tabs"></nav><main class="pref-content"></main><footer class="pref-footer"></footer>';
  app.querySelector(".pref-footer")!.textContent = t(
    "Changes are saved automatically.",
  );
  async function update(key: string, value: any) {
    try {
      prefs = await invoke("set_preferences", { values: { [key]: value } });
    } catch (e) {
      alert(String(e));
    }
  }
  function render() {
    const nav = app.querySelector("#pref-tabs")!;
    nav.replaceChildren();
    for (const name of Object.keys(groups)) {
      const b = document.createElement("button");
      b.textContent = t(name);
      b.classList.toggle("active", name === tab);
      b.onclick = () => {
        tab = name;
        render();
      };
      nav.append(b);
    }
    const main = app.querySelector(".pref-content")!;
    main.replaceChildren();
    if (tab === "Terminal") {
      const p = document.createElement("p");
      p.className = "pref-note";
      p.textContent = t(
        "Open documents from Terminal: macdownplus README.md\nRead standard input: cat README.md | macdownplus -\nInstall into a directory included in your PATH. The tool launches this copy of the application.",
      );
      p.style.whiteSpace = "pre-line";
      const b = document.createElement("button");
      b.textContent = t("Install Command Line Tool…");
      b.onclick = async () => {
        try {
          const path = await invoke<string | null>("install_cli");
          if (path) alert(t("Installed: {path}", { path }));
        } catch (e) {
          alert(String(e));
        }
      };
      main.append(p, b);
      return;
    }
    for (const [key, label, options] of groups[tab]) {
      const row = document.createElement("label");
      row.className = "pref-row";
      const text = document.createElement("span");
      text.textContent = t(label);
      const value = prefs[key];
      if (typeof value === "boolean") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = value;
        input.onchange = () => void update(key, input.checked);
        row.append(input, text);
      } else if (key === "editorBaseFontInfo") {
        row.append(text);
        for (const part of ["name", "size"]) {
          const input = document.createElement("input");
          input.type = part === "size" ? "number" : "text";
          input.value = String(value[part]);
          input.setAttribute(
            "aria-label",
            t(part === "size" ? "Font size" : "Font family"),
          );
          input.onchange = () =>
            void update(key, {
              ...prefs[key],
              [part]: part === "size" ? Number(input.value) : input.value,
            });
          row.append(input);
        }
      } else {
        row.append(text);
        const choices =
          key === "editorStyleName"
            ? boot.resources.Themes
            : key === "htmlStyleName"
              ? boot.resources.Styles
              : key === "htmlTemplateName"
                ? [...new Set(["Default", ...boot.resources.Templates])]
                : options;
        if (choices) {
          const select = document.createElement("select");
          for (const [i, v] of choices.entries()) {
            const opt = document.createElement("option");
            opt.textContent = options ? t(v) : v;
            opt.value = typeof value === "number" ? String(i) : v;
            select.append(opt);
          }
          select.value = String(value);
          select.onchange = () =>
            void update(
              key,
              typeof value === "number" ? Number(select.value) : select.value,
            );
          row.append(select);
        } else {
          const input = document.createElement("input");
          input.type = typeof value === "number" ? "number" : "text";
          input.value = String(value);
          input.onchange = () =>
            void update(
              key,
              typeof value === "number" ? Number(input.value) : input.value,
            );
          row.append(input);
        }
        if (key === "htmlDefaultDirectoryUrl") {
          const b = document.createElement("button");
          b.textContent = t("Choose…");
          b.onclick = async (e) => {
            e.preventDefault();
            const path = await invoke<string | null>("choose_directory");
            if (path) {
              await update(key, path);
              render();
            }
          };
          row.append(b);
        }
      }
      main.append(row);
    }
    if (tab === "Editor" || tab === "HTML")
      for (const kind of tab === "Editor"
        ? ["Themes"]
        : ["Styles", "Templates"]) {
        const b = document.createElement("button");
        b.textContent = t(`Open ${kind} Folder…`);
        b.style.marginRight = "8px";
        b.onclick = () => void invoke("reveal_resources", { kind });
        main.append(b);
      }
  }
  await listen<Preferences>("preferences-changed", (e) => {
    prefs = e.payload;
  });
  render();
}
