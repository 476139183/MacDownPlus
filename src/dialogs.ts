import { t } from "./i18n";
const app = document.querySelector<HTMLDivElement>("#app")!;
export function notify(message: unknown) {
  let toast = document.querySelector<HTMLDivElement>("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    app.append(toast);
  }
  toast.textContent = t(String(message));
  setTimeout(() => {
    if (toast?.textContent === t(String(message))) toast.textContent = "";
  }, 6000);
}
export function ask(
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
    h.textContent = t(title);
    p.textContent = t(message);
    actions.className = "actions";
    dialog.append(h, p);
    if (extra) dialog.append(extra);
    dialog.append(actions);
    for (const [i, label] of buttons.entries()) {
      const b = document.createElement("button");
      b.textContent = t(label);
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
