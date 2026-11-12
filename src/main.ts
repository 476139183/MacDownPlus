import { colorSelection } from "./colors";
import { setLanguage, t, phrases } from "./i18n";
import "./style.css";
import { ask, notify } from "./dialogs";
import { applicationActions, applicationAction } from "./application";
import { PreviewSnapshots } from "./preview";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  placeholder,
} from "@codemirror/view";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  search,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  SearchQuery,
} from "@codemirror/search";
import { decorate, exportedHTML, type Preferences } from "./renderer";
import { format } from "./format";
import { preferencesUI } from "./preferences";
type FileInfo = { path: string; name: string; content: string };
type Boot = {
  locale?: string;
  translations?: Record<string, string>;
  document: FileInfo;
  text: string;
  dirty: boolean;
  preferences: Preferences;
  selfTest?: boolean;
  openTest?: boolean;
};
const app = document.querySelector<HTMLDivElement>("#app")!;
async function editorUI() {
  let receiveDocument:
    ((document: Pick<Boot, "document" | "text" | "dirty">) => void) | undefined;
  let queuedDocument: Pick<Boot, "document" | "text" | "dirty"> | undefined;
  await listen<Pick<Boot, "document" | "text" | "dirty">>(
    "document-changed",
    (event) => {
      if (receiveDocument) receiveDocument(event.payload);
      else queuedDocument = event.payload;
    },
  );
  const boot = await invoke<Boot>("bootstrap");
  setLanguage(boot.locale, boot.translations);
  let prefs = boot.preferences,
    file = boot.document,
    saved = file.content,
    ratio = 0.5,
    editorHidden = false,
    previewHidden = false,
    applyingDocument = false,
    renderVersion = 0,
    token = "",
    previewRatio = 0,
    renderedHTML = "",
    syncMuted = 0,
    renderTimer = 0,
    persistTimer = 0;
  app.innerHTML =
    '<nav id="toolbar" hidden aria-label="Formatting"></nav><main id="workspace"><section id="editor" aria-label="Markdown editor"></section><div id="divider" role="separator" tabindex="0" aria-label="Resize panes" aria-valuemin="10" aria-valuemax="90" aria-valuenow="50"></div><iframe id="preview" title="Markdown preview" sandbox="allow-scripts"></iframe></main><footer id="status" hidden></footer><div id="toast" role="status"></div>';
  for (const node of app.querySelectorAll("[aria-label], [title]")) {
    for (const attr of ["aria-label", "title"]) {
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, t(value));
    }
  }
  const frame = app.querySelector<HTMLIFrameElement>("#preview")!,
    editor = app.querySelector<HTMLElement>("#editor")!,
    divider = app.querySelector<HTMLElement>("#divider")!,
    theme = new Compartment(),
    options = new Compartment(),
    lineEnding = new Compartment();
  const snapshots = new PreviewSnapshots(frame);
  const current = () => view.state.doc.toString();
  const dirty = () => current() !== saved;
  async function persist() {
    clearTimeout(persistTimer);
    await invoke("update_document", { text: current(), dirty: dirty() });
  }
  const view = new EditorView({
    parent: editor,
    state: EditorState.create({
      doc: boot.text,
      extensions: [
        EditorState.phrases.of(phrases()),
        lineEnding.of(
          EditorState.lineSeparator.of(
            boot.text.includes("\r\n") ? "\r\n" : "\n",
          ),
        ),
        history(),
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocorrect: "on",
          autocapitalize: "off",
        }),
        drawSelection(),
        highlightActiveLine(),
        markdown({ codeLanguages: languages }),
        search({ top: true }),
        placeholder(""),
        theme.of([]),
        options.of([]),
        keymap.of([
          {
            key: "Enter",
            run: (v) => {
              if (!prefs.editorInsertPrefixInBlock) return false;
              const s = v.state.selection.main;
              if (!s.empty) return false;
              const line = v.state.doc.lineAt(s.from),
                before = line.text.slice(0, s.from - line.from),
                m = before.match(
                  /^(\s*)(?:(\d+)[.)]\s+|([-+*])\s+(\[[ xX]\]\s+)?|(>\s*))/,
                );
              if (!m) return false;
              if (!before.slice(m[0].length).trim()) {
                v.dispatch({
                  changes: { from: line.from, to: s.from, insert: "" },
                });
                return true;
              }
              let prefix =
                m[1] +
                (m[2]
                  ? `${Number(m[2]) + (prefs.editorAutoIncrementNumberedLists ? 1 : 0)}. `
                  : m[3]
                    ? `${m[3]} ${m[4] ? "[ ] " : ""}`
                    : m[5]);
              const insert = "\n" + prefix;
              v.dispatch({
                changes: { from: s.from, insert },
                selection: { anchor: s.from + insert.length },
                userEvent: "input",
              });
              return true;
            },
          },
          {
            key: "Home",
            run: (v) => {
              if (!prefs.editorSmartHome) return false;
              const s = v.state.selection.main,
                line = v.state.doc.lineAt(s.head),
                first = line.from + (line.text.match(/^\s*/)?.[0].length || 0);
              v.dispatch({
                selection: { anchor: s.head === first ? line.from : first },
                scrollIntoView: true,
              });
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            if (applyingDocument) {
              count();
              return;
            }
            void invoke("mark_document", {
              text: current(),
              dirty: dirty(),
            }).catch(notify);
            clearTimeout(renderTimer);
            clearTimeout(persistTimer);
            persistTimer = window.setTimeout(
              () => void persist().catch(notify),
              250,
            );
            if (!prefs.markdownManualRender)
              renderTimer = window.setTimeout(
                () => void render().catch(notify),
                150,
              );
            count();
          }
        }),
      ],
    }),
  });
  async function applyPreferences() {
    const raw = await invoke<string>("get_resource", {
      kind: "Themes",
      name: prefs.editorStyleName,
    });
    const sections: Record<string, Record<string, string>> = {};
    let section = "editor";
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match = line.match(/^([\w-]+):\s*(.*)$/);
      if (match) (sections[section] ||= {})[match[1]] = match[2];
      else section = line.trim();
    }
    const color = (
      section: string,
      property = "foreground",
      fallback = "#ccc",
    ) => {
      const value = sections[section]?.[property];
      return value
        ? /^[0-9a-f]{6}$/i.test(value)
          ? "#" + value
          : value
        : fallback;
    };
    const font = prefs.editorBaseFontInfo || { name: "Menlo", size: 14 },
      bg = color("editor", "background", "#2d2d2d");
    const highlight = HighlightStyle.define([
      ...[
        tags.heading1,
        tags.heading2,
        tags.heading3,
        tags.heading4,
        tags.heading5,
        tags.heading6,
      ].map((tag, i) => ({
        tag,
        color: color(`H${i + 1}`),
        fontSize: sections[`H${i + 1}`]?.["font-size"],
        fontWeight:
          sections[`H${i + 1}`]?.["font-style"] === "bold" ? "bold" : undefined,
      })),
      { tag: tags.heading, color: color("H1"), fontWeight: "bold" },
      { tag: tags.emphasis, color: color("EMPH"), fontStyle: "italic" },
      { tag: tags.strong, color: color("STRONG"), fontWeight: "bold" },
      { tag: tags.link, color: color("LINK") },
      { tag: tags.url, color: color("AUTO_LINK_URL") },
      { tag: tags.monospace, color: color("CODE") },
      { tag: tags.quote, color: color("BLOCKQUOTE") },
      { tag: tags.list, color: color("LIST_BULLET") },
      { tag: tags.comment, color: color("COMMENT") },
    ]);
    view.dispatch({
      effects: [
        theme.reconfigure([
          EditorView.theme({
            "&": { backgroundColor: bg, color: color("editor") },
            ".cm-content": {
              fontFamily: `${JSON.stringify(font.name)}, monospace`,
              fontSize: `${font.size}px`,
              lineHeight: `${Number(font.size) * 1.5 + Number(prefs.editorLineSpacing)}px`,
              padding: `${prefs.editorVerticalInset}px ${prefs.editorHorizontalInset}px`,
              caretColor: color("editor", "caret"),
              maxWidth: prefs.editorWidthLimited
                ? `${prefs.editorMaximumWidth}px`
                : "none",
              margin: "0 auto",
              minHeight: prefs.editorScrollsPastEnd
                ? "calc(100% + 60vh)"
                : "100%",
            },
            ".cm-scroller": { fontFamily: "inherit" },
            "&.cm-focused .cm-selectionBackground,.cm-selectionBackground": {
              backgroundColor: color(
                "editor-selection",
                "background",
                "#515151",
              ),
            },
            ".cm-cursor": { borderLeftColor: color("editor", "caret") },
            ".cm-activeLine": { backgroundColor: "transparent" },
            ".cm-line": { padding: "0" },
          }),
          syntaxHighlighting(highlight),
        ]),
        options.reconfigure([
          bracketMatching(),
          ...(prefs.editorCompleteMatchingCharacters
            ? [closeBrackets(), keymap.of(closeBracketsKeymap)]
            : []),
          keymap.of([
            {
              key: "Tab",
              run: (v) => {
                if (!prefs.editorConvertTabs) return indentWithTab.run!(v);
                const s = v.state.selection.main;
                v.dispatch({
                  changes: { from: s.from, to: s.to, insert: "    " },
                  selection: { anchor: s.from + 4 },
                  userEvent: "input",
                });
                return true;
              },
            },
          ]),
        ]),
      ],
    });
    app.querySelector<HTMLElement>("#workspace")!.style.flexDirection =
      prefs.editorOnRight ? "row-reverse" : "row";
    count();
    await render();
  }
  function count() {
    const text = current(),
      status = app.querySelector<HTMLElement>("#status")!;
    status.hidden = !prefs.editorShowWordCount;
    const words = [
      ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
    ].filter((s) => s.isWordLike).length;
    status.textContent =
      prefs.editorWordCountType === 1
        ? t("{count} characters", { count: [...text].length })
        : prefs.editorWordCountType === 2
          ? t("{count} characters", {
              count: [...text.replace(/\s/g, "")].length,
            })
          : t("{count} words", { count: words });
  }
  function layout() {
    editor.hidden = editorHidden;
    frame.hidden = previewHidden;
    divider.hidden = editorHidden || previewHidden;
    editor.style.width = previewHidden ? "100%" : `${ratio * 100}%`;
    divider.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
  async function render() {
    const version = ++renderVersion,
      text = current();
    const result = await invoke<{ html: string }>("render_document", {
      content: text,
    });
    const next = crypto.randomUUID(),
      html = await decorate(result.html, text, prefs, next);
    if (version !== renderVersion) return;
    renderedHTML = html;
    token = next;
    snapshots.begin(token);
    frame.srcdoc = html;
  }
  const snapshot = () => snapshots.snapshot();
  async function save(saveAs = false) {
    let capture = current();
    if (
      prefs.editorEnsuresNewlineAtEndOfFile &&
      capture &&
      !capture.endsWith("\n")
    ) {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" } });
      capture = current();
    }
    await persist();
    const result = await invoke<FileInfo | null>("save_document", {
      content: capture,
      saveAs,
    });
    if (!result) return false;
    file = result;
    saved = capture;
    await persist();
    return true;
  }
  async function approveClose() {
    if (!dirty()) return true;
    const answer = await ask(
      t("Save changes to “{name}”?", { name: file.name }),
      "Your changes will be lost if you do not save them.",
      ["Don't Save", "Cancel", "Save"],
    );
    return (
      answer === "Don't Save" ||
      (answer === "Save" && (await save()) && !dirty())
    );
  }
  function replaceDocument(next: Pick<Boot, "document" | "text" | "dirty">) {
    applyingDocument = true;
    clearTimeout(renderTimer);
    clearTimeout(persistTimer);
    previewRatio = 0;
    file = next.document;
    saved = file.content;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next.text },
      selection: { anchor: 0 },
      effects: lineEnding.reconfigure(
        EditorState.lineSeparator.of(
          next.text.includes("\r\n") ? "\r\n" : "\n",
        ),
      ),
    });
    applyingDocument = false;
    void render()
      .then(() => reportOpened())
      .catch(notify);
  }
  const toolbar: [string, string][] = [
    ["B", "toggleStrong"],
    ["I", "toggleEmphasis"],
    ["U", "toggleUnderline"],
    ["S̶", "toggleStrikethrough"],
    ["Mark", "toggleHighlight"],
    ["Code", "toggleInlineCode"],
    ["Comment", "toggleComment"],
    ...Array.from(
      { length: 6 },
      (_, i) => [`H${i + 1}`, `convertToH${i + 1}`] as [string, string],
    ),
    ["¶", "convertToParagraph"],
    ["1.", "toggleOrderedList"],
    ["•", "toggleUnorderedList"],
    ["❯", "toggleBlockquote"],
    ["→", "indent"],
    ["←", "unindent"],
    ["Link", "toggleLink"],
    ["Image", "toggleImage"],
    ["Text color", "textColor"],
    ["Background color", "backgroundColor"],
    ["Clear colors", "clearColors"],
    ["Render", "render"],
  ];
  for (const [label, id] of toolbar) {
    const b = document.createElement("button");
    b.textContent = t(label);
    b.title = t(id);
    b.onclick = () => void action(id).catch(notify);
    app.querySelector("#toolbar")!.append(b);
  }
  async function action(id: string) {
    if (["textColor", "backgroundColor", "clearColors"].includes(id)) {
      if (view.state.selection.main.empty) {
        notify(t("Select text to format."));
        return;
      }
      if (id === "clearColors") colorSelection(view);
      else {
        const extra = document.createElement("div"),
          picker = document.createElement("input"),
          label = document.createElement("label"),
          hex = document.createElement("input");
        picker.type = "color";
        picker.value = id === "textColor" ? "#c62828" : "#fff59d";
        picker.setAttribute("aria-label", t("Choose color"));
        hex.type = "text";
        hex.value = picker.value;
        hex.maxLength = 7;
        hex.pattern = "#[0-9a-fA-F]{6}";
        label.textContent = t("Hex color");
        label.append(hex);
        picker.oninput = () => {
          hex.value = picker.value;
        };
        hex.oninput = () => {
          if (/^#[0-9a-f]{6}$/i.test(hex.value)) picker.value = hex.value;
        };
        extra.append(picker, label);
        const answer = await ask(
          id === "textColor" ? "Text color" : "Background color",
          "",
          ["Cancel", "Apply"],
          extra,
        );
        if (answer !== "Apply") {
          view.focus();
          return;
        }
        if (!/^#[0-9a-f]{6}$/i.test(hex.value)) {
          notify(t("Enter a color such as #c62828."));
          view.focus();
          return;
        }
        colorSelection(
          view,
          id === "textColor" ? "color" : "background-color",
          hex.value,
        );
      }
      clearTimeout(renderTimer);
      await render();
      return;
    }
    const extension: Record<string, string> = {
      toggleStrikethrough: "extensionStrikethough",
      toggleUnderline: "extensionUnderline",
      toggleHighlight: "extensionHighlight",
    };
    if (extension[id] && !prefs[extension[id]])
      prefs = await invoke("set_preferences", {
        values: { [extension[id]]: true },
      });

    if (applicationActions.has(id)) {
      await applicationAction(id, prefs);
      return;
    }
    const clipboard =
      id === "toggleLink" || id === "toggleImage"
        ? await invoke<string | null>("clipboard_url")
        : null;
    if (
      format(
        view,
        id,
        ["*", "-", "+"][prefs.editorUnorderedListMarkerType] || "*",
        clipboard || "",
      )
    ) {
      clearTimeout(renderTimer);
      await render();
      return;
    }
    if (id.startsWith("performFindPanelAction:")) {
      const tag = id.split(":")[1];
      if (tag === "2") findNext(view);
      else if (tag === "3") findPrevious(view);
      else if (tag === "7") {
        const s = view.state.selection.main;
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({
              search: view.state.doc.sliceString(s.from, s.to),
            }),
          ),
        });
      } else openSearchPanel(view);
      return;
    }
    switch (id) {
      case "newDocument":
        await invoke("new_document");
        break;
      case "openDocument":
        await persist();
        await invoke("open_documents");
        break;
      case "saveDocument":
        await save();
        break;
      case "saveDocumentAs":
        await save(true);
        break;
      case "performClose":
        if (await approveClose()) {
          const approvedText = current();
          await persist();
          await invoke("close_document", { approvedText });
        }
        break;
      case "quit-confirm":
        const approved = await approveClose();
        const approvedText = current();
        await persist();
        await invoke("confirm_quit", { approved, approvedText });
        break;
      case "terminate":
        await invoke("request_quit");
        break;
      case "revertDocumentToSaved":
        if (
          !dirty() ||
          (await ask(
            "Revert to Saved?",
            "All changes since the last save will be lost.",
            ["Cancel", "Revert"],
          )) === "Revert"
        )
          replaceDocument(await invoke("revert_document"));
        break;
      case "render":
        await render();
        break;
      case "copyHtml":
        await navigator.clipboard.writeText(exportedHTML(await snapshot()));
        break;
      case "exportHtml": {
        const extra = document.createElement("div");
        for (const [name, label] of [
          ["style", "Include styles"],
          ["highlight", "Include syntax highlighting"],
        ]) {
          const row = document.createElement("label"),
            input = document.createElement("input");
          input.type = "checkbox";
          input.checked = true;
          input.name = name;
          row.append(input, document.createTextNode(t(label)));
          extra.append(row);
        }
        if (
          (await ask("Export HTML", "", ["Cancel", "Export"], extra)) ===
          "Export"
        )
          await invoke("export_document", {
            html: exportedHTML(
              await snapshot(),
              extra.querySelector<HTMLInputElement>("[name=style]")!.checked,
              extra.querySelector<HTMLInputElement>("[name=highlight]")!
                .checked,
            ),
          });
        break;
      }
      case "exportPdf":
      case "printDocument":
        await invoke("print_document", {
          html: exportedHTML(await snapshot()),
          pdf: id === "exportPdf",
        });
        break;
      case "setEditorOneQuarter":
        ratio = 0.25;
        editorHidden = previewHidden = false;
        layout();
        break;
      case "setEqualSplit":
        ratio = 0.5;
        editorHidden = previewHidden = false;
        layout();
        break;
      case "setEditorThreeQuarters":
        ratio = 0.75;
        editorHidden = previewHidden = false;
        layout();
        break;
      case "togglePreviewPane":
        previewHidden = !previewHidden;
        editorHidden = false;
        layout();
        break;
      case "toggleEditorPane":
        editorHidden = !editorHidden;
        previewHidden = false;
        layout();
        break;
      case "toggleToolbar":
        app.querySelector<HTMLElement>("#toolbar")!.hidden =
          !app.querySelector<HTMLElement>("#toolbar")!.hidden;
        break;
      case "toggleFullScreen": {
        const w = getCurrentWindow();
        await w.setFullscreen(!(await w.isFullscreen()));
        break;
      }
      case "centerSelectionInVisibleArea":
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, {
            y: "center",
          }),
        });
        break;
      case "startSpeaking": {
        const s = view.state.selection.main;
        await invoke("speech", {
          text: s.empty ? current() : view.state.doc.sliceString(s.from, s.to),
        });
        break;
      }
      case "stopSpeaking":
        await invoke("speech", { text: null });
        break;
      case "undo":
        undo(view);
        break;
      case "redo":
        redo(view);
        break;
      default:
        await invoke("native_action", { selector: id });
    }
  }
  editor.addEventListener("scroll", () => {}, true);
  view.scrollDOM.addEventListener("scroll", () => {
    if (!prefs.editorSyncScrolling || Date.now() < syncMuted) return;
    const el = view.scrollDOM;
    frame.contentWindow?.postMessage(
      {
        token,
        type: "scroll",
        ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
      },
      "*",
    );
  });
  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.data?.token !== token) return;
    const data = e.data;
    snapshots.accept(token, data.type, data.html);
    if (data.type === "ready") {
      const el = view.scrollDOM;
      const ratio = prefs.editorSyncScrolling
        ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)
        : previewRatio;
      frame.contentWindow?.postMessage({ token, type: "scroll", ratio }, "*");
    }
    if (data.type === "scroll" && typeof data.ratio === "number")
      previewRatio = data.ratio;
    if (
      data.type === "scroll" &&
      prefs.editorSyncScrolling &&
      typeof data.ratio === "number"
    ) {
      syncMuted = Date.now() + 150;
      const el = view.scrollDOM;
      el.scrollTop =
        Math.max(0, Math.min(1, data.ratio)) *
        (el.scrollHeight - el.clientHeight);
    }
    if (data.type === "link" && typeof data.href === "string") {
      void (
        /^(https?:|mailto:)/.test(data.href)
          ? invoke("open_external", { url: data.href })
          : invoke("open_relative", {
              link: decodeURIComponent(data.href.split("#")[0]),
            })
      ).catch(notify);
    }
  });
  divider.onpointerdown = (e) => {
    divider.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      const area = app.querySelector("#workspace")!.getBoundingClientRect();
      ratio = Math.max(
        0.1,
        Math.min(
          0.9,
          (prefs.editorOnRight
            ? area.right - event.clientX
            : event.clientX - area.left) / area.width,
        ),
      );
      layout();
    };
    divider.onpointermove = move;
    divider.onpointerup = () => {
      divider.onpointermove = null;
    };
  };
  divider.onkeydown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      ratio = Math.max(
        0.1,
        Math.min(0.9, ratio + (e.key === "ArrowLeft" ? -0.05 : 0.05)),
      );
      layout();
    }
  };
  await listen<string>(
    "menu-action",
    (e) => void action(e.payload).catch(notify),
  );
  await listen<Preferences>("preferences-changed", (e) => {
    prefs = e.payload;
    void applyPreferences().catch(notify);
  });
  receiveDocument = replaceDocument;
  if (queuedDocument) {
    replaceDocument(queuedDocument);
    queuedDocument = undefined;
  }
  await listen<string>("app-error", (e) => notify(e.payload));
  await listen<boolean>("print-result", (e) => {
    if (!e.payload) notify("Printing was cancelled or failed.");
  });
  // Browser shortcuts supplement native menus for editor focus and automated interaction.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const map: Record<string, string> = {
        s: e.shiftKey ? "saveDocumentAs" : "saveDocument",
        r: "render",
        b: e.shiftKey ? "toggleBlockquote" : "toggleStrong",
        i: e.shiftKey ? "toggleImage" : "toggleEmphasis",
        u: e.shiftKey ? "toggleUnorderedList" : "toggleUnderline",
        k: e.shiftKey ? "toggleLink" : "toggleInlineCode",
        f: "performFindPanelAction:1",
        g: e.shiftKey ? "performFindPanelAction:3" : "performFindPanelAction:2",
      };
      if (map[key]) {
        e.preventDefault();
        e.stopPropagation();
        void action(map[key]).catch(notify);
      }
    },
    true,
  );
  async function reportOpened() {
    if (!boot.openTest || !file.path) return;
    const html = await snapshot();
    await invoke("open_test_report", {
      content: current(),
      preview: html.includes("<body"),
      language: document.documentElement.lang,
    });
  }
  layout();
  await applyPreferences();
  await persist();
  view.focus();
  if (boot.openTest) {
    await invoke("open_test_ready");
    await reportOpened();
  }
  if (boot.selfTest) {
    try {
      view.dispatch({ selection: EditorSelection.range(2, 7) });
      const textColored = colorSelection(view, "color", "#c62828");
      const backgroundColored = colorSelection(
        view,
        "background-color",
        "#fff59d",
      );
      const underlineStart = current().length;
      const underlineProbe = "\n\nUnderline 中文。\n\n";
      view.dispatch({
        changes: { from: underlineStart, insert: underlineProbe },
        selection: EditorSelection.range(
          underlineStart + 2,
          underlineStart + underlineProbe.length,
        ),
      });
      await action("toggleUnderline");
      clearTimeout(renderTimer);
      await render();
      const html = exportedHTML(await snapshot()),
        parsed = new DOMParser().parseFromString(html, "text/html");
      const checks = {
        heading: parsed.querySelector("h1")?.textContent === "Hello",
        highlight: Boolean(parsed.querySelector("code.language-rust .token")),
        diagrams: parsed.querySelectorAll("svg").length === 2,
        ipc: !html.includes("__TAURI_INTERNALS__"),
        nativeDocument: file.path.endsWith("fixture.md"),
        revert: false,
        underline:
          parsed.querySelector("u")?.textContent === "Underline 中文。",
        inlineColors:
          textColored &&
          backgroundColored &&
          parsed.querySelector<HTMLSpanElement>("h1 span")?.style.color ===
            "rgb(198, 40, 40)" &&
          parsed.querySelector<HTMLSpanElement>("h1 span")?.style
            .backgroundColor === "rgb(255, 245, 157)",
      };
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: "\nSaved from WKWebView.\n",
        },
      });
      checks.nativeDocument = checks.nativeDocument && (await save());
      const savedBeforeRevert = current();
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: "\nDISCARDED CHANGE\n",
        },
      });
      await persist();
      replaceDocument(await invoke("revert_document"));
      checks.revert = current() === savedBeforeRevert;
      const printed = new Promise<boolean>((resolve, reject) => {
        void listen<boolean>("print-result", (e) => resolve(e.payload));
        setTimeout(() => reject(Error("Native PDF export timed out")), 20000);
      });
      await invoke("print_document", { html, pdf: true });
      const pdf = await printed;
      await invoke("self_test_report", {
        report: {
          passed: Object.values(checks).every(Boolean) && pdf,
          checks,
          pdf,
          userAgent: navigator.userAgent,
        },
      });
    } catch (error) {
      await invoke("self_test_report", {
        report: { passed: false, error: String(error) },
      });
    }
  }
}
if (location.search.includes("preferences")) void preferencesUI().catch(notify);
else
  void editorUI().catch(async (e) => {
    notify(e);
    console.error(e);
    await invoke("self_test_report", {
      report: { passed: false, error: String(e) },
    }).catch(() => {});
  });
