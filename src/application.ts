import { invoke } from "@tauri-apps/api/core";
import { ask } from "./dialogs";
import type { Preferences } from "./renderer";
export const applicationActions = new Set([
  "runPageLayout",
  "showPreferencesWindow",
  "showHelp",
  "showContributing",
  "plugins",
  "orderFrontStandardAboutPanel",
  "checkForUpdates",
]);
export async function applicationAction(id: string, prefs: Preferences) {
  switch (id) {
    case "runPageLayout":
      await invoke("page_setup");
      break;
    case "showPreferencesWindow":
      await invoke("preferences_window");
      break;
    case "showHelp":
      await invoke("show_help");
      break;
    case "showContributing":
      await invoke("open_external", {
        url: "https://github.com/476139183/MacDownPlus",
      });
      break;
    case "plugins":
      await invoke("reveal_resources", { kind: "PlugIns" });
      break;
    case "orderFrontStandardAboutPanel":
      await ask(
        "MacDownPlus 0.1.1",
        "Markdown editor built with Rust + Tauri.\nBased on MacDown by Tzu-ping Chung.\nMacDown: https://github.com/MacDownApp/macdown\nMIT license; complete third-party notices are included with the source distribution.",
        ["Close"],
      );
      break;
    case "checkForUpdates": {
      const response = await fetch(
        "https://api.github.com/repos/476139183/MacDownPlus/releases",
      );
      if (!response.ok)
        throw Error("Unable to check releases (" + response.status + ").");
      const releases = await response.json();
      const latest = releases.find(
        (r: any) =>
          !r.draft && (prefs.updateIncludesPreReleases || !r.prerelease),
      );
      if (latest && latest.tag_name !== "v0.1.1") {
        if (
          (await ask("New release available", latest.name || latest.tag_name, [
            "Cancel",
            "View Release",
          ])) === "View Release"
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
  }
}
