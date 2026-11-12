import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type Colors = Partial<Record<"color" | "background-color", string>>;
type Span = {
  from: number;
  openEnd: number;
  closeStart: number;
  to: number;
  colors: Colors;
};
const hex = /^#[\da-f]{6}$/i;
function parseColors(tag: string): Colors | null {
  const match = /^<span\s+style="([^"]+)"\s*>$/i.exec(tag);
  if (!match) return null;
  const colors: Colors = {};
  for (const declaration of match[1].split(";")) {
    if (!declaration.trim()) continue;
    const [key, value] = declaration
      .split(":")
      .map((s) => s.trim().toLowerCase());
    if (
      (key !== "color" && key !== "background-color") ||
      !hex.test(value || "")
    )
      return null;
    colors[key] = value;
  }
  return Object.keys(colors).length ? colors : null;
}
function colorSpans(text: string): Span[] {
  const spans: Span[] = [],
    stack: Array<{ from: number; openEnd: number; colors: Colors | null }> = [];
  for (const token of text.matchAll(/<span\b[^>]*>|<\/span\s*>/gi)) {
    const from = token.index!;
    if (/^<\//.test(token[0])) {
      const open = stack.pop();
      if (open?.colors)
        spans.push({
          ...open,
          colors: open.colors,
          closeStart: from,
          to: from + token[0].length,
        });
    } else
      stack.push({
        from,
        openEnd: from + token[0].length,
        colors: parseColors(token[0]),
      });
  }
  return spans.sort((a, b) => a.from - b.from);
}
/** Rewrite only the selected color runs, retaining Markdown and colors outside the selection. */
export function colorSelection(
  view: EditorView,
  property?: keyof Colors,
  value?: string,
): boolean {
  if (property && !hex.test(value || "")) return false;
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const source = view.state.doc.toString(),
    spans = colorSpans(source);
  let start = from,
    end = to;
  // Include complete enclosing runs so partial recoloring can split, rather than nest, them.
  for (const span of spans)
    if (span.from < to && span.to > from) {
      start = Math.min(start, span.from);
      end = Math.max(end, span.to);
    }
  const relevant = spans.filter((s) => s.from >= start && s.to <= end);
  const boundaries = new Set([start, end, from, to]);
  for (const s of relevant)
    for (const n of [s.from, s.openEnd, s.closeStart, s.to]) boundaries.add(n);
  const points = [...boundaries].sort((a, b) => a - b);
  let output = "",
    selectionStart: number | undefined,
    selectionEnd: number | undefined;
  // Merge adjacent pieces that share a style before serializing them.
  const runs: Array<{
    text: string;
    colors: Colors;
    selected: boolean;
    lineStart: boolean;
  }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (
      a === b ||
      relevant.some(
        (s) =>
          (a >= s.from && b <= s.openEnd) || (a >= s.closeStart && b <= s.to),
      )
    )
      continue;
    let colors: Colors = {};
    for (const s of relevant)
      if (a >= s.openEnd && b <= s.closeStart)
        colors = { ...colors, ...s.colors };
    const selected = a >= from && b <= to;
    if (selected)
      colors = property ? { ...colors, [property]: value!.toLowerCase() } : {};
    const text = source.slice(a, b),
      previous = runs.at(-1);
    if (
      previous &&
      previous.selected === selected &&
      JSON.stringify(previous.colors) === JSON.stringify(colors)
    )
      previous.text += text;
    else
      runs.push({
        text,
        colors,
        selected,
        lineStart: a === 0 || source[a - 1] === "\n",
      });
  }
  for (const run of runs) {
    const style = Object.entries(run.colors)
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
    // Keep block prefixes and blank lines outside inline HTML so headings/lists keep working.
    let lineStart = run.lineStart;
    for (const line of run.text.split(/(\r?\n)/)) {
      if (!line || /^\r?\n$/.test(line) || !style) {
        if (run.selected) {
          selectionStart ??= output.length;
          selectionEnd = output.length + line.length;
        }
        output += line;
        if (line) lineStart = line.endsWith("\n");
        continue;
      }
      const prefix = lineStart
        ? line.match(
            /^(?: {0,3}(?:#{1,6}\s+|>\s*|(?:[-+*]|\d+[.)])\s+))/,
          )?.[0] || ""
        : "";
      output += prefix + `<span style="${style}">`;
      if (run.selected) {
        selectionStart ??= output.length;
        selectionEnd = output.length + line.length - prefix.length;
      }
      output += line.slice(prefix.length) + "</span>";
      lineStart = false;
    }
  }
  if (selectionStart === undefined) return false;
  view.dispatch({
    changes: { from: start, to: end, insert: output },
    selection: EditorSelection.range(
      start + selectionStart,
      start + selectionEnd!,
    ),
    userEvent: "input",
  });
  view.focus();
  return true;
}
