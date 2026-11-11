import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const defaults = JSON.parse(
  readFileSync("crates/markdown-core/src/defaults.json", "utf8"),
);
async function setup(page: Page, text = "# Hello\n\nText", preferences = {}) {
  let prefs = { ...defaults, ...preferences };
  const events: Record<string, number[]> = {};
  let saved = text;
  let delayed = false;
  await page.exposeFunction("testInvoke", async (cmd: string, args: any) => {
    if (cmd === "bootstrap")
      return {
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
        return w.testInvoke(cmd, args);
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
