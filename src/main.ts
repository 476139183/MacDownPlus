import "./style.css";
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
  document: FileInfo;
  text: string;
  dirty: boolean;
  preferences: Preferences;
  selfTest?: boolean;
};
const app = document.querySelector<HTMLDivElement>("#app")!;
function notify(message: unknown) {
  let toast = document.querySelector<HTMLDivElement>("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    app.append(toast);
  }
  toast.textContent = String(message);
  setTimeout(() => {
    if (toast?.textContent === String(message)) toast.textContent = "";
  }, 6000);
}
function ask(
  title: string,
  message: string,
  buttons: string[],
  extra?: HTMLElement,
): Promise<string> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog"),
      h = document.createElement("h2"),
      p = document.createElement("p"),
      actions = document.createElement("div");
    h.textContent = title;
    p.textContent = message;
    actions.className = "actions";
    dialog.append(h, p);
    if (extra) dialog.append(extra);
    dialog.append(actions);
    for (const [i, label] of buttons.entries()) {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = i === buttons.length - 1 ? "primary" : "";
      b.onclick = () => {
        dialog.close();
        dialog.remove();
        resolve(label);
      };
      actions.append(b);
    }
    dialog.oncancel = (e) => {
      e.preventDefault();
      dialog.remove();
      resolve("Cancel");
    };
    app.append(dialog);
    dialog.showModal();
  });
}
async function editorUI() {
  let boot = await invoke<Boot>("bootstrap"),
    prefs = boot.preferences,
    file = boot.document,
    saved = file.content,
    ratio = 0.5,
    editorHidden = false,
    previewHidden = false,
    renderVersion = 0,
    token = "",
    frameReady = false,
    renderedHTML = "",
    pendingSnapshot: ((v: string) => void) | null = null,
    syncMuted = 0,
    renderTimer: number,
    persistTimer: number;
  app.innerHTML =
    '<nav id="toolbar" hidden aria-label="Formatting"></nav><main id="workspace"><section id="editor" aria-label="Markdown editor"></section><div id="divider" role="separator" tabindex="0" aria-label="Resize panes" aria-valuemin="10" aria-valuemax="90" aria-valuenow="50"></div><iframe id="preview" title="Markdown preview" sandbox="allow-scripts"></iframe></main><footer id="status" hidden></footer><div id="toast" role="status"></div>';
  const frame = app.querySelector<HTMLIFrameElement>("#preview")!,
    editor = app.querySelector<HTMLElement>("#editor")!,
    divider = app.querySelector<HTMLElement>("#divider")!,
    theme = new Compartment(),
    options = new Compartment(),
    lineEnding = new Compartment();
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
        ? `${[...text].length} characters`
        : prefs.editorWordCountType === 2
          ? `${[...text.replace(/\s/g, "")].length} characters`
          : `${words} words`;
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
    frameReady = false;
    frame.srcdoc = html;
  }
  async function snapshot() {
    if (!frameReady)
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (frameReady) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - started > 20000) {
            clearInterval(timer);
            reject(
              Error(
                "Preview is still rendering. Please retry after equations and diagrams finish.",
              ),
            );
          }
        }, 50);
      });
    return new Promise<string>((resolve, reject) => {
      pendingSnapshot = resolve;
      frame.contentWindow?.postMessage({ token, type: "snapshot" }, "*");
      setTimeout(() => {
        if (pendingSnapshot === resolve) {
          pendingSnapshot = null;
          reject(Error("Preview did not respond."));
        }
      }, 5000);
    });
  }
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
      `Save changes to “${file.name}”?`,
      "Your changes will be lost if you do not save them.",
      ["Don't Save", "Cancel", "Save"],
    );
    return answer === "Don't Save" || (answer === "Save" && (await save()));
  }
  function replaceDocument(next: Pick<Boot, "document" | "text" | "dirty">) {
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
    void render();
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
    ["Render", "render"],
  ];
  for (const [label, id] of toolbar) {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = id;
    b.onclick = () => void action(id).catch(notify);
    app.querySelector("#toolbar")!.append(b);
  }
  async function action(id: string) {
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
    )
      return;
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
        if (await approveClose()) await invoke("close_document");
        break;
      case "quit-confirm":
        await invoke("confirm_quit", { approved: await approveClose() });
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
          row.append(input, document.createTextNode(label));
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
      case "runPageLayout":
        await invoke("page_setup");
        break;
      case "showPreferencesWindow":
        await invoke("preferences_window");
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
      case "showHelp":
        await invoke("show_help");
        break;
      case "showContributing":
        await invoke("open_external", {
          url: "https://github.com/476139183/MacDown-Rust",
        });
        break;
      case "plugins":
        await invoke("reveal_resources", { kind: "PlugIns" });
        break;
      case "orderFrontStandardAboutPanel":
        await ask(
          "MacDown Rust 0.1.0",
          "Markdown editor built with Rust + Tauri.\nBased on MacDown by Tzu-ping Chung.\nMacDown: https://github.com/MacDownApp/macdown\nMIT license; complete third-party notices are included with the source distribution.",
          ["Close"],
        );
        break;
      case "checkForUpdates": {
        const response = await fetch(
          "https://api.github.com/repos/476139183/MacDown-Rust/releases",
        );
        if (!response.ok)
          throw Error("Unable to check releases (" + response.status + ").");
        const releases = await response.json();
        const latest = releases.find(
          (r: any) =>
            !r.draft && (prefs.updateIncludesPreReleases || !r.prerelease),
        );
        if (latest && latest.tag_name !== "v0.1.0") {
          if (
            (await ask(
              "New release available",
              latest.name || latest.tag_name,
              ["Cancel", "View Release"],
            )) === "View Release"
          )
            await invoke("open_external", { url: latest.html_url });
        } else
          await ask(
            "Check for Updates",
            latest
              ? "You are running the latest published version."
              : "No releases have been published yet.",
            ["Close"],
          );
        break;
      }
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
    if (data.type === "ready") {
      frameReady = true;
    }
    if (data.type === "snapshot" && typeof data.html === "string") {
      pendingSnapshot?.(data.html);
      pendingSnapshot = null;
    }
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
  await listen<Pick<Boot, "document" | "text" | "dirty">>(
    "document-changed",
    (e) => replaceDocument(e.payload),
  );
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
  layout();
  await applyPreferences();
  await persist();
  view.focus();
  if (boot.selfTest) {
    try {
      const html = exportedHTML(await snapshot()),
        parsed = new DOMParser().parseFromString(html, "text/html");
      const checks = {
        heading: parsed.querySelector("h1")?.textContent === "Hello",
        highlight: Boolean(parsed.querySelector("code.language-rust .token")),
        diagrams: parsed.querySelectorAll("svg").length === 2,
        ipc: !html.includes("__TAURI_INTERNALS__"),
        nativeDocument: file.path.endsWith("fixture.md"),
      };
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: "\nSaved from WKWebView.\n",
        },
      });
      checks.nativeDocument = checks.nativeDocument && (await save());
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
