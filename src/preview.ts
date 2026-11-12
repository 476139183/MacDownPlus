/** One preview generation owns its readiness and a shared, bounded snapshot request. */
export class PreviewSnapshots {
  private token = "";
  private ready = false;
  private pending?: {
    promise: Promise<string>;
    resolve: (html: string) => void;
    reject: (error: Error) => void;
    timer: number;
  };
  constructor(private frame: HTMLIFrameElement) {}
  begin(token: string) {
    this.cancel("预览内容已变化，请重新导出。");
    this.token = token;
    this.ready = false;
  }
  accept(token: string, type: string, html?: string) {
    if (token !== this.token) return;
    if (type === "ready") this.ready = true;
    if (type === "snapshot" && typeof html === "string" && this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      clearTimeout(pending.timer);
      pending.resolve(html);
    }
  }
  cancel(message: string) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(Error(message));
  }
  async snapshot(): Promise<string> {
    const token = this.token;
    const start = Date.now();
    while (!this.ready) {
      if (token !== this.token) throw Error("预览内容已变化，请重新导出。");
      if (Date.now() - start > 20000) throw Error("预览仍在渲染，请稍后重试。");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (token !== this.token) throw Error("预览内容已变化，请重新导出。");
    if (this.pending) return this.pending.promise;
    let resolve!: (html: string) => void, reject!: (error: Error) => void;
    const promise = new Promise<string>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const timer = window.setTimeout(
      () => this.cancel("预览未响应，请重试。"),
      5000,
    );
    this.pending = { promise, resolve, reject, timer };
    this.frame.contentWindow?.postMessage({ token, type: "snapshot" }, "*");
    return promise;
  }
}
