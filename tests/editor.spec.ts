import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const defaults = JSON.parse(
  readFileSync("crates/markdown-core/src/defaults.json", "utf8"),
);
async function setup(
  page: Page,
  text = "# Hello\n\nText",
  preferences = {},
  locale = "en",
) {
  let prefs = { ...defaults, ...preferences };
  const events: Record<string, number[]> = {};
  let saved = text;
  let delayed = false;
  await page.exposeFunction("testInvoke", async (cmd: string, args: any) => {
    if (cmd === "bootstrap")
      return {
        locale,
        document: { path: "/tmp/test.md", name: "Test.md", content: saved },
        text,
        dirty: false,
        preferences: prefs,
        resources: {
          Themes: ["Tomorrow+"],
          Styles: ["GitHub2"],
          Templates: ["Default"],
        },
      };
    if (cmd === "get_resource")
      return readFileSync(
        `public/vendor/macdown/${args.kind}/${args.name}.${args.kind === "Themes" ? "style" : "css"}`,
        "utf8",
      );
    if (cmd === "render_document") {
      const r = spawnSync(resolve("target/debug/examples/render-json"), {
        input: JSON.stringify({ content: args.content, preferences: prefs }),
        encoding: "utf8",
      });
      if (r.error || r.status !== 0) throw Error(String(r.error || r.stderr));
      return JSON.parse(r.stdout);
    }
    if (cmd === "save_document") {
      if (delayed) await new Promise((r) => setTimeout(r, 600));
      saved = args.content;
      return { path: "/tmp/test.md", name: "Test.md", content: saved };
    }
    if (cmd === "set_preferences") {
      prefs = { ...prefs, ...args.values };
      return prefs;
    }
    if (cmd === "test_delay") delayed = true;
    return null;
  });
  await page.addInitScript(() => {
    const w = window as any,
      callbacks = new Map<number, Function>(),
      events = new Map<string, number[]>();
    let next = 0;
    w.__calls = [];
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (cb: Function) => {
        callbacks.set(++next, cb);
        return next;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: (cmd: string, args: any) => {
        if (cmd === "plugin:event|listen") {
          events.set(args.event, [
            ...(events.get(args.event) || []),
            args.handler,
          ]);
          return Promise.resolve(args.handler);
        }
        if (cmd === "plugin:event|unlisten") return Promise.resolve();
        w.__calls.push({ cmd, args });
        if (cmd === "save_document") w.__saving = true;
        const result = w.testInvoke(cmd, args);
        return cmd === "save_document"
          ? Promise.resolve(result).then((value) => {
              w.__saveFinished = true;
              return value;
            })
          : result;
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.menu = (payload: string) => {
      for (const id of events.get("menu-action") || [])
        callbacks.get(id)?.({ event: "menu-action", payload });
    };
  });
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.frameLocator("#preview").locator("body")).toContainText(
    "Hello",
  );
}
async function menu(page: Page, action: string) {
  await page.evaluate((id) => (window as any).menu(id), action);
}
test("default layout and formatting match the split editor", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator("#toolbar")).toBeHidden();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("Hello");
  await page.keyboard.press("Meta+a");
  await menu(page, "toggleStrong");
  await expect(page.locator(".cm-content")).toContainText("**Hello**");
  await expect(page.frameLocator("#preview").locator("strong")).toBeVisible();
  await menu(page, "togglePreviewPane");
  await expect(page.locator("#preview")).toBeHidden();
  await menu(page, "setEqualSplit");
  await expect(page.locator("#preview")).toBeVisible();
});

test("save-and-close retains edits made while the save is pending", async ({
  page,
}) => {
  await setup(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" unsaved");
  await page.evaluate(() => (window as any).testInvoke("test_delay", {}));
  await menu(page, "performClose");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => (window as any).__saving);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" later edit");
  await page.waitForFunction(() => (window as any).__saveFinished);
  await expect(page.locator(".cm-content")).toContainText("later edit");
  expect(
    await page.evaluate(() =>
      (window as any).__calls.some(
        (call: any) => call.cmd === "close_document",
      ),
    ),
  ).toBe(false);
});

test("overlapping Copy HTML actions both complete", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copied.push(text);
        },
      },
    });
    (window as any).menu("copyHtml");
    (window as any).menu("copyHtml");
  });
  await page.waitForFunction(() => (window as any).__copied.length === 2);
  expect(
    await page.evaluate(
      () => (window as any).__copied[0] === (window as any).__copied[1],
    ),
  ).toBe(true);
});

test("application actions remain available while Preferences has focus", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/?preferences");
  await expect(
    page.getByRole("button", { name: "General", exact: true }),
  ).toBeVisible();
  await menu(page, "orderFrontStandardAboutPanel");
  await expect(page.getByRole("dialog")).toContainText("MacDownPlus");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await menu(page, "showHelp");
  await page.waitForFunction(() =>
    (window as any).__calls.some((call: any) => call.cmd === "show_help"),
  );
  await menu(page, "runPageLayout");
  await page.waitForFunction(() =>
    (window as any).__calls.some((call: any) => call.cmd === "page_setup"),
  );
});
test("cancel close preserves edits; edits during save remain unsaved", async ({
  page,
}) => {
  await setup(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" new");
  await menu(page, "performClose");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("new");
  await page.evaluate(() => (window as any).testInvoke("test_delay", {}));
  await menu(page, "saveDocument");
  await page.waitForFunction(() => (window as any).__saving);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" during save");
  await expect(page.locator(".cm-content")).toContainText("during save");
  await page.waitForTimeout(700);
  await menu(page, "performClose");
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("preview isolates document scripts and cannot access desktop IPC", async ({
  page,
}) => {
  await setup(
    page,
    '# Hello\n\n<script>parent.__compromised=1</script>\n<img src=x onerror="parent.__compromised=2">',
  );
  await expect(page.frameLocator("#preview").locator("script")).toHaveCount(2);
  expect(
    await page.evaluate(() => (window as any).__compromised),
  ).toBeUndefined();
  expect(
    await page
      .frameLocator("#preview")
      .locator("body")
      .evaluate(() => {
        try {
          return Boolean((parent as any).__TAURI_INTERNALS__);
        } catch {
          return false;
        }
      }),
  ).toBe(false);
});
test("vendored Prism, Mermaid and Graphviz produce preview output", async ({
  page,
}) => {
  await setup(
    page,
    "# Hello\n\n```rust\nfn main() {}\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n\n```dot\ndigraph { a -> b }\n```",
    { htmlSyntaxHighlighting: true, htmlMermaid: true, htmlGraphviz: true },
  );
  const preview = page.frameLocator("#preview");
  await expect(preview.locator("code.language-rust .token")).not.toHaveCount(0);
  await expect(preview.locator("svg")).toHaveCount(2);
});
test("manual rendering and HTML export use the displayed document", async ({
  page,
}) => {
  await setup(page, "# Hello", { markdownManualRender: true });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("# Updated");
  await expect(page.frameLocator("#preview").locator("h1")).toHaveText("Hello");
  await menu(page, "render");
  await expect(page.frameLocator("#preview").locator("h1")).toHaveText(
    "Updated",
  );
  await menu(page, "exportHtml");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForFunction(() =>
    (window as any).__calls.some((x: any) => x.cmd === "export_document"),
  );
  const html = await page.evaluate(
    () =>
      (window as any).__calls.find((x: any) => x.cmd === "export_document").args
        .html,
  );
  expect(html).toContain("Updated");
  expect(html).not.toContain("<script");
});
test("preferences expose all five sections and save renderer toggles", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/?preferences");
  for (const name of ["General", "Editor", "Markdown", "HTML", "Terminal"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.getByLabel("Tables", { exact: true }).uncheck();
  await page.waitForFunction(() =>
    (window as any).__calls.some(
      (x: any) =>
        x.cmd === "set_preferences" && x.args.values.extensionTables === false,
    ),
  );
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByLabel("Task lists", { exact: true }).check();
  await page.waitForFunction(() =>
    (window as any).__calls.some(
      (x: any) =>
        x.cmd === "set_preferences" && x.args.values.htmlTaskList === true,
    ),
  );
});

test("format menu covers headings, lists, quotes, indentation and inline markup", async ({
  page,
}) => {
  await setup(page);
  const cases: [string, string][] = [
    ["toggleStrong", "**Hello**"],
    ["toggleEmphasis", "*Hello*"],
    ["toggleUnderline", "_Hello_"],
    ["toggleStrikethrough", "~~Hello~~"],
    ["toggleHighlight", "==Hello=="],
    ["toggleInlineCode", "`Hello`"],
    ["toggleComment", "<!--Hello-->"],
    ["toggleLink", "[Hello]()"],
    ["toggleImage", "![Hello]()"],
    ["convertToH1", "# Hello"],
    ["convertToH2", "## Hello"],
    ["convertToH3", "### Hello"],
    ["convertToH4", "#### Hello"],
    ["convertToH5", "##### Hello"],
    ["convertToH6", "###### Hello"],
    ["toggleOrderedList", "1. Hello"],
    ["toggleUnorderedList", "* Hello"],
    ["toggleBlockquote", "> Hello"],
    ["indent", "    Hello"],
    ["uppercaseWord", "HELLO"],
    ["lowercaseWord", "hello"],
  ];
  for (const [action, expected] of cases) {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("Hello");
    await page.keyboard.press("Meta+a");
    await menu(page, action);
    await expect(page.locator(".cm-content")).toHaveText(expected);
  }
});

for (const [locale, editor, save, cancel] of [
  ["zh-Hans", "编辑器", "保存", "取消"],
  ["zh-Hant", "編輯器", "儲存", "取消"],
]) {
  test(`${locale} translates preferences and keeps save actions and document content intact`, async ({
    page,
  }) => {
    await setup(page, "# Hello untranslated document", {}, locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator(".cm-content")).toHaveText(
      "# Hello untranslated document",
    );
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type(" changed");
    await menu(page, "performClose");
    await expect(
      page.getByRole("button", { name: save, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: cancel, exact: true }).click();
    expect(
      await page.evaluate(() =>
        (window as any).__calls.some((x: any) => x.cmd === "close_document"),
      ),
    ).toBe(false);
    await menu(page, "performClose");
    await page.getByRole("button", { name: save, exact: true }).click();
    await page.waitForFunction(() =>
      (window as any).__calls.some((x: any) => x.cmd === "save_document"),
    );
    const saved = await page.evaluate(
      () =>
        (window as any).__calls.find((x: any) => x.cmd === "save_document").args
          .content,
    );
    expect(saved).toContain("Hello untranslated document");
    await page.goto("/?preferences");
    await expect(
      page.getByRole("button", { name: editor, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: editor, exact: true }).click();
    await expect(
      page.getByLabel(locale === "zh-Hans" ? "字号" : "字級", { exact: true }),
    ).toBeVisible();
  });
}

test("format extensions render immediately when their toolbar actions are used", async ({
  page,
}) => {
  await setup(page, "# Hello", {
    extensionStrikethough: false,
    extensionHighlight: false,
    extensionUnderline: false,
    markdownManualRender: true,
  });
  for (const [action, tag] of [
    ["toggleStrikethrough", "del"],
    ["toggleHighlight", "mark"],
    ["toggleUnderline", "u"],
  ]) {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("Hello");
    await page.keyboard.press("Meta+a");
    await menu(page, action);
    await expect(page.frameLocator("#preview").locator(tag)).toHaveText(
      "Hello",
    );
  }
});

test("text and background colors render, export, undo and clear while preserving Markdown", async ({
  page,
}) => {
  await setup(page);
  await menu(page, "toggleToolbar");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("**Hello**");
  await page.keyboard.press("Meta+a");
  await page.getByRole("button", { name: "Text color", exact: true }).click();
  await page.getByLabel("Hex color", { exact: true }).fill("#c62828");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const strong = page.frameLocator("#preview").locator("strong");
  await expect(strong).toHaveCSS("color", "rgb(198, 40, 40)");
  await page
    .getByRole("button", { name: "Background color", exact: true })
    .click();
  await page.getByLabel("Hex color", { exact: true }).fill("#fff59d");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.frameLocator("#preview").locator('span[style*="background-color"]'),
  ).toHaveCSS("background-color", "rgb(255, 245, 157)");
  await menu(page, "copyHtml");
  // Export uses the same sanitized preview snapshot.
  await menu(page, "exportHtml");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForFunction(() =>
    (window as any).__calls.some((x: any) => x.cmd === "export_document"),
  );
  const exported = await page.evaluate(
    () =>
      (window as any).__calls.find((x: any) => x.cmd === "export_document").args
        .html,
  );
  expect(exported).toContain("color:#c62828");
  expect(exported).toContain("background-color:#fff59d");
  await page.getByRole("button", { name: "Clear colors", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("**Hello**");
  await expect(strong).toHaveText("Hello");
  await menu(page, "undo");
  await expect(page.locator(".cm-content")).toContainText(
    "background-color:#fff59d",
  );
});

test("partial recoloring and clearing preserves colors outside the selection", async ({
  page,
}) => {
  await setup(page);
  await menu(page, "toggleToolbar");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("Hello world");
  await page.keyboard.press("Meta+a");
  async function color(button: string, value: string) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByLabel("Hex color", { exact: true }).fill(value);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
  }
  await color("Text color", "#c62828");
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await color("Background color", "#fff59d");
  const preview = page.frameLocator("#preview");
  await expect(
    preview.locator("span").filter({ hasText: /^Hello$/ }),
  ).toHaveCSS("background-color", "rgb(255, 245, 157)");
  await expect(
    preview.locator("span").filter({ hasText: /^ world$/ }),
  ).toHaveCSS("color", "rgb(198, 40, 40)");
  await page.getByRole("button", { name: "Clear colors", exact: true }).click();
  await expect(preview.locator("p")).toHaveText("Hello world");
  await expect(preview.locator("span")).toHaveCount(1);
  await expect(preview.locator("span")).toHaveText(" world");
});

test("coloring headings and multiple paragraphs keeps their Markdown structure", async ({
  page,
}) => {
  await setup(page, "# Hello\n\nSecond paragraph");
  await menu(page, "toggleToolbar");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.getByRole("button", { name: "Text color", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const preview = page.frameLocator("#preview");
  await expect(preview.locator("h1")).toHaveText("Hello");
  await expect(preview.locator("p")).toHaveText("Second paragraph");
  await expect(preview.locator("h1 span")).toHaveCSS(
    "color",
    "rgb(198, 40, 40)",
  );
  await expect(preview.locator("p span")).toHaveCSS(
    "color",
    "rgb(198, 40, 40)",
  );
});

test("underline excludes trailing blank lines and toggles cleanly for Chinese text", async ({
  page,
}) => {
  await setup(page);
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText(
    "Hello 此文件仅用于演示，不会修改你的其他文档。\n\n",
  );
  await page.keyboard.press("Meta+a");
  await menu(page, "toggleUnderline");
  await expect(page.frameLocator("#preview").locator("u")).toHaveText(
    "Hello 此文件仅用于演示，不会修改你的其他文档。",
  );
  await expect(editor).toContainText(
    "_Hello 此文件仅用于演示，不会修改你的其他文档。_",
  );
  await menu(page, "toggleUnderline");
  await expect(page.frameLocator("#preview").locator("u")).toHaveCount(0);
  await expect(editor).not.toContainText("_");
});

test("underline spans multiple paragraphs without leaving literal underscores", async ({
  page,
}) => {
  await setup(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("Hello 第一段。\n\n第二段。\n");
  await page.keyboard.press("Meta+a");
  await menu(page, "toggleUnderline");
  const preview = page.frameLocator("#preview");
  await expect(preview.locator("u")).toHaveText(["Hello 第一段。", "第二段。"]);
  await expect(preview.locator("body")).not.toContainText("_");
  await menu(page, "toggleUnderline");
  await expect(preview.locator("u")).toHaveCount(0);
});

test("reapplying underline repairs the old closing marker on a blank line", async ({
  page,
}) => {
  await setup(page, "# Hello\n\n_Hello 中文。\n\n_");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  // Select the malformed paragraph, including its detached closing marker.
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("_Hello 中文。\n\n_");
  await page.keyboard.press("Meta+a");
  await menu(page, "toggleUnderline");
  const preview = page.frameLocator("#preview");
  await expect(preview.locator("u")).toHaveText("Hello 中文。");
  await expect(preview.locator("body")).not.toContainText("_");
});


test("underline keeps full-width spaces in later selected lines",async({page})=>{
  await setup(page);
  await page.locator(".cm-content").click();await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("Hello\n\n　中文段落。　\n");await page.keyboard.press("Meta+a");
  await menu(page,"toggleUnderline");
  const text=await page.evaluate(()=>(window as any).__calls.filter((x:any)=>x.cmd==="mark_document").at(-1).args.text);
  expect(text).toBe("_Hello_\n\n　_中文段落。_　\n");
});
