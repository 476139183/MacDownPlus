import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
export function format(
  view: EditorView,
  action: string,
  marker = "*",
  url = "",
) {
  let { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  let selected = doc.sliceString(from, to);
  const wraps: Record<string, [string, string]> = {
    toggleStrong: ["**", "**"],
    toggleEmphasis: ["*", "*"],
    toggleUnderline: ["_", "_"],
    toggleStrikethrough: ["~~", "~~"],
    toggleHighlight: ["==", "=="],
    toggleInlineCode: ["`", "`"],
    toggleComment: ["<!--", "-->"],
    toggleLink: ["[", "]()"],
    toggleImage: ["![", "]()"],
  };
  const wrap = wraps[action];
  if (wrap) {
    const [a, b] = wrap;
    const inline = [
      "toggleStrong",
      "toggleEmphasis",
      "toggleUnderline",
      "toggleStrikethrough",
      "toggleHighlight",
      "toggleInlineCode",
    ].includes(action);
    if (inline && selected.length) {
      const leading = selected.match(/^\s*/u)![0].length;
      const content = selected.trim();
      if (!content) {
        view.focus();
        return true;
      }
      from += leading;
      to = from + content.length;
      selected = content;
      if (selected.includes("\n")) {
        // Older versions could leave the closing marker on a line of its own.
        if (selected.startsWith(a) && selected.endsWith("\n" + b))
          selected = selected.slice(a.length, -b.length);
        let atLineStart = doc.lineAt(from).from === from;
        const lines = selected.split(/(\r?\n)/).map((text) => {
          const prefix = atLineStart
            ? text.match(
                /^(?: {0,3}(?:#{1,6}[ \t]+|>[ \t]*|(?:[-+*]|\d+[.)])[ \t]+))/,
              )?.[0] || ""
            : "";
          atLineStart = text.endsWith("\n");
          const body = text.slice(prefix.length),
            leading = body.match(/^[^\S\r\n]*/u)![0],
            trailing = body.match(/[^\S\r\n]*$/u)![0];
          return { text, prefix, leading, trailing, body: body.trim() };
        });
        const nonempty = lines.filter((line) => line.body);
        const remove =
          nonempty.length > 0 &&
          nonempty.every(
            (line) =>
              line.body.startsWith(a) &&
              line.body.endsWith(b) &&
              line.body.length >= a.length + b.length,
          );
        const text = lines
          .map((line) =>
            !line.body
              ? line.text
              : line.prefix +
                line.leading +
                (remove
                  ? line.body.slice(a.length, -b.length)
                  : a + line.body + b) +
                line.trailing,
          )
          .join("");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: EditorSelection.range(from, from + text.length),
          userEvent: "input",
        });
        view.focus();
        return true;
      }
    }
    let start = from,
      end = to,
      text = a + selected + b,
      sel = EditorSelection.range(
        from + a.length,
        from + a.length + selected.length,
      );
    if (
      selected.startsWith(a) &&
      selected.endsWith(b) &&
      selected.length >= a.length + b.length
    ) {
      text = selected.slice(a.length, -b.length);
      sel = EditorSelection.range(from, from + text.length);
    } else if (
      from >= a.length &&
      doc.sliceString(from - a.length, from) === a &&
      doc.sliceString(to, to + b.length) === b
    ) {
      start -= a.length;
      end += b.length;
      text = selected;
      sel = EditorSelection.range(start, start + selected.length);
    }
    if (
      (action === "toggleLink" || action === "toggleImage") &&
      text === a + selected + b
    ) {
      const position = from + a.length + selected.length + 2;
      text = a + selected + "](" + url + ")";
      sel = EditorSelection.range(position, position + url.length);
    }
    view.dispatch({
      changes: { from: start, to: end, insert: text },
      selection: sel,
      userEvent: "input",
    });
    view.focus();
    return true;
  }
  if (["uppercaseWord", "lowercaseWord", "capitalizeWord"].includes(action)) {
    let start = from,
      end = to;
    if (start === end) {
      const line = doc.lineAt(from);
      const local = from - line.from;
      const left =
        line.text.slice(0, local).match(/[\p{L}\p{N}_]+$/u)?.[0] || "";
      const right = line.text.slice(local).match(/^[\p{L}\p{N}_]+/u)?.[0] || "";
      start -= left.length;
      end += right.length;
    }
    const text = doc.sliceString(start, end),
      result =
        action === "uppercaseWord"
          ? text.toUpperCase()
          : action === "lowercaseWord"
            ? text.toLowerCase()
            : text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    view.dispatch({ changes: { from: start, to: end, insert: result } });
    return true;
  }
  if (action === "insertNewParagraph") {
    view.dispatch({
      changes: { from, to, insert: "\n\n" },
      selection: { anchor: from + 2 },
      userEvent: "input",
    });
    return true;
  }
  if (action === "delete") {
    view.dispatch({
      changes: {
        from: from === to ? Math.max(0, from - 1) : from,
        to,
        insert: "",
      },
      userEvent: "delete",
    });
    return true;
  }
  const first = doc.lineAt(from),
    last = doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to);
  const lines = doc.sliceString(first.from, last.to).split("\n");
  let result: string[] | null = null;
  if (/^convertToH[1-6]$/.test(action) || action === "convertToParagraph") {
    const prefix =
      action === "convertToParagraph"
        ? ""
        : "#".repeat(Number(action.slice(-1))) + " ";
    result = lines.map((s) => prefix + s.replace(/^\s*#{1,6}\s+/, ""));
  }
  if (action === "indent") result = lines.map((s) => "    " + s);
  if (action === "unindent")
    result = lines.map((s) => s.replace(/^( {1,4}|\t)/, ""));
  const lists: Record<string, RegExp> = {
    toggleOrderedList: /^\s*\d+[.)]\s+/,
    toggleUnorderedList: /^\s*[-+*]\s+/,
    toggleBlockquote: /^\s*>\s?/,
  };
  if (lists[action]) {
    const pattern = lists[action],
      remove = lines.every((s) => !s.trim() || pattern.test(s));
    result = lines.map((s, i) =>
      remove
        ? s.replace(pattern, "")
        : (action === "toggleOrderedList"
            ? `${i + 1}. `
            : action === "toggleBlockquote"
              ? "> "
              : marker + " ") + s.replace(/^\s*(?:\d+[.)]|[-+*])\s+/, ""),
    );
  }
  if (result) {
    const insert = result.join("\n");
    view.dispatch({
      changes: { from: first.from, to: last.to, insert },
      selection: EditorSelection.range(first.from, first.from + insert.length),
      userEvent: "input",
    });
    view.focus();
    return true;
  }
  return false;
}
