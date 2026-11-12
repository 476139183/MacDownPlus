import { test, expect } from "@playwright/test";
test("a waiting snapshot cannot send its old token after a newer preview becomes ready", async ({
  page,
}) => {
  await page.route("**/preview-unit.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Preview unit</title>",
    }),
  );
  await page.goto("/preview-unit.html");
  const result = await page.evaluate(async () => {
    const { PreviewSnapshots } = await import("/src/preview.ts");
    const sent: any[] = [];
    const frame = {
      contentWindow: { postMessage: (data: any) => sent.push(data) },
    } as any;
    const snapshots = new PreviewSnapshots(frame);
    snapshots.begin("old");
    const old = snapshots.snapshot().then(
      () => "resolved",
      (error) => String(error),
    );
    snapshots.begin("new");
    snapshots.accept("new", "ready");
    const oldResult = await old;
    const current = snapshots.snapshot();
    snapshots.accept("new", "snapshot", "current document");
    return { oldResult, sent, current: await current };
  });
  expect(result.oldResult).toContain("预览内容已变化");
  expect(result.sent).toEqual([{ token: "new", type: "snapshot" }]);
  expect(result.current).toBe("current document");
});
