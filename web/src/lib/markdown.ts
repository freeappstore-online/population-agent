// Minimal, safe markdown renderer. Escapes HTML first, then re-introduces
// bold, inline code, and pipe tables. Used to render the assistant's output
// without pulling in a heavy markdown lib or accepting raw HTML risk.

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch]!,
  );
}

function renderTable(lines: string[]): string {
  const splitRow = (l: string): string[] =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  const thead =
    "<thead><tr>" +
    header.map((c) => `<th>${c}</th>`).join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    rows
      .map(
        (r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>",
      )
      .join("") +
    "</tbody>";
  return `<table>${thead}${tbody}</table>`;
}

export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])
    ) {
      const tableLines = [line];
      i++;
      tableLines.push(lines[i]);
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableLines));
      continue;
    }
    out.push(line);
    i++;
  }
  let joined = out.join("\n");
  joined = joined.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  joined = joined.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  return joined;
}
