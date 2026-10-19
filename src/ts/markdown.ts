function escapeHtml(text: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (character) => entities[character]);
}

type LinkReference = { destination: string; title: string };

function renderInline(text: string, references: Map<string, LinkReference> = new Map()): string {
  const protectedHtml: string[] = [];
  const protect = (html: string): string => `\u0000${protectedHtml.push(html) - 1}\u0000`;
  let source = text.replace(/\u0000/g, "").replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_match, escaped: string) =>
    protect(escapeHtml(escaped)));

  source = source.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_match, _ticks: string, code: string) =>
    protect(`<code>${escapeHtml(code.replace(/\n/g, " "))}</code>`));

  const safeLink = (label: string, destination: string, title = "", formatLabel = true): string => {
    const href = destination.replace(/&amp;/g, "&");
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return `[${label}](${destination})`;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    const isPlainDestinationLabel = label === destination ||
      destination.toLowerCase() === `mailto:${label.toLowerCase()}`;
    const renderedLabel = formatLabel && !isPlainDestinationLabel
      ? renderInline(label, references)
      : escapeHtml(label);
    return `<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${renderedLabel}</a>`;
  };
  source = source.replace(/\[([^\]]+)\]\(\s*(https?:\/\/[^\s)]+|mailto:[^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/gi,
    (_match, label: string, destination: string, title: string | undefined) =>
      protect(safeLink(label, destination, title)));
  source = source.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g,
    (match, label: string, reference: string | undefined) => {
      const key = (reference || label).trim().toLowerCase().replace(/\s+/g, " ");
      const link = references.get(key);
      return link ? protect(safeLink(label, link.destination, link.title)) : match;
    });
  source = source.replace(/<(https?:\/\/[^ >]+|mailto:[^ >]+)>/gi, (_match, href: string) =>
    protect(safeLink(href, href, "", false)));
  source = source.replace(/\bhttps?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi, (href) =>
    protect(safeLink(href, href, "", false)));
  source = source.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) =>
    protect(safeLink(email, `mailto:${email}`, "", false)));

  let html = escapeHtml(source);
  const replacements: Array<[RegExp, string]> = [
    [/\*\*(.+?)\*(.+?)\*\*\*/g, "<strong>$1<em>$2</em></strong>"],
    [/\*(.+?)\*\*(.+?)\*\*/g, "<em>$1<strong>$2</strong></em>"],
    [/__(.+?)_(.+?)___/g, "<strong>$1<em>$2</em></strong>"],
    [/_(.+?)__(.+?)__/g, "<em>$1<strong>$2</strong></em>"],
    [/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>"],
    [/___(.+?)___/g, "<strong><em>$1</em></strong>"],
    [/\*\*(.+?)\*\*/g, "<strong>$1</strong>"],
    [/__(.+?)__/g, "<strong>$1</strong>"],
    [/~~(.+?)~~/g, "<del>$1</del>"],
    [/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>"],
    [/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>"],
  ];
  for (const [pattern, replacement] of replacements) html = html.replace(pattern, replacement);
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => protectedHtml[Number(index)]);
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === "\\" && row[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      inCode = !inCode;
      cell += character;
    } else if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function escapeTablePipes(markdown: string): string {
  let escaped = "";
  let inCode = false;
  for (const character of markdown) {
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) escaped += "\\";
    escaped += character;
  }
  return escaped;
}

function tableCell(value: string, alignment: string | undefined, tag: "th" | "td", references: Map<string, LinkReference>): string {
  const align = alignment ? ` data-align="${alignment}"` : "";
  const content = renderInline(value.replace(/<br\s*\/?>/gi, "\n"), references).replace(/\n/g, "<br>");
  return `<${tag}${align}>${content || (tag === "td" ? "<br>" : "")}</${tag}>`;
}

export function renderCodeBlock(
  language: string,
  code = "",
  emptyLanguageLabel = "CODE",
): string {
  const label = language.trim().toUpperCase() || emptyLanguageLabel;
  return `<section class="code-block"><div class="code-block-header" contenteditable="false"><button type="button" class="copy-code-button" aria-label="Copy code" title="Copy code"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 3V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button><span>${escapeHtml(label)}</span></div><pre><code>${escapeHtml(code)}</code></pre></section>`;
}

export function renderMarkdown(markdown: string, emptyLanguageLabel = "CODE"): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const references = new Map<string, LinkReference>();
  let insideFence = "";
  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!insideFence) insideFence = fence[1][0];
      else if (fence[1][0] === insideFence) insideFence = "";
      continue;
    }
    if (insideFence) continue;
    const definition = lines[index].match(/^ {0,3}\[([^\]]+)\]:\s*(\S+?)(?:\s+["'(](.*?)["')])?\s*$/);
    if (definition) {
      references.set(definition[1].trim().toLowerCase().replace(/\s+/g, " "), {
        destination: definition[2],
        title: definition[3] ?? "",
      });
      lines[index] = "";
    }
  }

  const renderParagraph = (paragraph: string[]): string => {
    const rendered = paragraph.map((line, index) => {
      if (index === paragraph.length - 1) return renderInline(line.trimEnd(), references);
      if (/ {2,}$/.test(line)) return `${renderInline(line.trimEnd(), references)}<br>`;
      if (/\\$/.test(line)) return `${renderInline(line.slice(0, -1), references)}<br>`;
      return `${renderInline(line.trimEnd(), references)} `;
    });
    return `<p>${rendered.join("")}</p>`;
  };
  const listMatch = (line: string): RegExpMatchArray | null =>
    line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);

  const renderList = (start: number, indent: number): { html: string; next: number } => {
    const initial = listMatch(lines[start]);
    const ordered = !!initial && /^\d/.test(initial[2]);
    const tag = ordered ? "ol" : "ul";
    const startNumber = ordered ? Number.parseInt(initial[2], 10) : 1;
    const items: string[] = [];
    let index = start;

    while (index < lines.length) {
      const match = listMatch(lines[index]);
      if (!match || match[1].length !== indent || /^\d/.test(match[2]) !== ordered) break;
      let content = match[3];
      index += 1;
      const nested: string[] = [];
      while (index < lines.length) {
        const nestedMatch = listMatch(lines[index]);
        if (nestedMatch && nestedMatch[1].length > indent) {
          const result = renderList(index, nestedMatch[1].length);
          nested.push(result.html);
          index = result.next;
          continue;
        }
        if (!lines[index].trim()) {
          if (index + 1 < lines.length) {
            const nextMatch = listMatch(lines[index + 1]);
            if (nextMatch && nextMatch[1].length > indent) {
              index += 1;
              continue;
            }
          }
          break;
        }
        if (lines[index].search(/\S/) <= indent) break;
        content += ` ${lines[index].trim()}`;
        index += 1;
      }

      const task = content.match(/^\[([ xX])\]\s+(.*)$/);
      const taskPrefix = task
        ? `<input type="checkbox" contenteditable="false" tabindex="-1"${task[1].toLowerCase() === "x" ? " checked" : ""}> `
        : "";
      const body = task ? task[2] : content;
      items.push(`<li>${taskPrefix}${renderInline(body, references)}${nested.join("")}</li>`);
      if (index < lines.length && !lines[index].trim()) {
        index += 1;
        if (index >= lines.length || !listMatch(lines[index])) break;
      }
    }
    const startAttribute = ordered && startNumber !== 1 ? ` start="${startNumber}"` : "";
    return { html: `<${tag}${startAttribute}>${items.join("")}</${tag}>`, next: index };
  };

  const renderBlocks = (blockLines: string[]): string => {
    const output: string[] = [];
    let paragraph: string[] = [];
    const flushParagraph = (): void => {
      if (paragraph.length) output.push(renderParagraph(paragraph));
      paragraph = [];
    };
    for (let index = 0; index < blockLines.length; index += 1) {
      const line = blockLines[index];
      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
      if (fence) {
        flushParagraph();
        const codeLines: string[] = [];
        const marker = fence[1][0];
        const minimumLength = fence[1].length;
        index += 1;
        while (index < blockLines.length) {
          const closingFence = blockLines[index].match(/^ {0,3}(`+|~+)\s*$/);
          if (closingFence && closingFence[1][0] === marker && closingFence[1].length >= minimumLength) break;
          codeLines.push(blockLines[index]);
          index += 1;
        }
        if (index < blockLines.length) index += 1;
        output.push(renderCodeBlock(fence[2] ?? "", codeLines.join("\n"), emptyLanguageLabel));
        continue;
      }
      const tableHeaders = splitTableRow(line);
      const separator = blockLines[index + 1] ? splitTableRow(blockLines[index + 1]) : [];
      if (line.includes("|") && tableHeaders.length === separator.length &&
        separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        flushParagraph();
        const alignments = separator.map((cell) =>
          cell.startsWith(":") && cell.endsWith(":") ? "center" :
            cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : undefined);
        const rowHtml = (cells: string[], tag: "th" | "td"): string =>
          `<tr>${tableHeaders.map((_header, cellIndex) =>
            tableCell(cells[cellIndex] ?? "", alignments[cellIndex], tag, references)).join("")}</tr>`;
        const rows = [rowHtml(tableHeaders, "th")];
        index += 2;
        while (index < blockLines.length && blockLines[index].trim() && blockLines[index].includes("|")) {
          rows.push(rowHtml(splitTableRow(blockLines[index]), "td"));
          index += 1;
        }
        index -= 1;
        output.push(`<table class="markdown-table"><thead>${rows[0]}</thead><tbody>${rows.slice(1).join("")}</tbody></table>`);
        continue;
      }
      const atxHeading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (atxHeading) {
        flushParagraph();
        const level = atxHeading[1].length;
        output.push(`<h${level}>${renderInline(atxHeading[2], references)}</h${level}>`);
        continue;
      }
      if (index + 1 < blockLines.length && /^ {0,3}(=+|-+)\s*$/.test(blockLines[index + 1]) && paragraph.length === 0) {
        flushParagraph();
        const level = blockLines[index + 1].trimStart().startsWith("=") ? 1 : 2;
        output.push(`<h${level}>${renderInline(line.trim(), references)}</h${level}>`);
        index += 1;
        continue;
      }
      if (/^ {0,3}(---+|___+|\*\*\*+)\s*$/.test(line)) {
        flushParagraph();
        output.push("<hr>");
        continue;
      }
      if (/^ {0,3}>/.test(line)) {
        flushParagraph();
        const quoteLines: string[] = [];
        while (index < blockLines.length && /^ {0,3}>/.test(blockLines[index])) {
          quoteLines.push(blockLines[index].replace(/^ {0,3}> ?/, ""));
          index += 1;
        }
        index -= 1;
        output.push(`<blockquote>${renderBlocks(quoteLines)}</blockquote>`);
        continue;
      }
      const list = listMatch(line);
      if (list) {
        flushParagraph();
        const result = renderList(index, list[1].length);
        output.push(result.html);
        index = result.next - 1;
        continue;
      }
      if (/^(?: {4}|\t)/.test(line)) {
        flushParagraph();
        const codeLines = [line.replace(/^(?: {4}|\t)/, "")];
        while (index + 1 < blockLines.length && /^(?: {4}|\t)/.test(blockLines[index + 1])) {
          index += 1;
          codeLines.push(blockLines[index].replace(/^(?: {4}|\t)/, ""));
        }
        output.push(renderCodeBlock("", codeLines.join("\n"), emptyLanguageLabel));
        continue;
      }
      paragraph.push(line);
    }
    flushParagraph();
    return output.join("\n");
  };
  return renderBlocks(lines);
}

export function renderMarkdownTableHeader(headerLine: string): string | null {
  const headers = splitTableRow(headerLine);
  if (!headerLine.includes("|") || !headers.some((header) => header.trim())) return null;
  const separator = headers.map(() => "---");
  const emptyRow = headers.map(() => "");
  return renderMarkdown([
    headerLine,
    `| ${separator.join(" | ")} |`,
    `| ${emptyRow.join(" | ")} |`,
  ].join("\n"));
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element) ||
    node.getAttribute("contenteditable") === "false") return "";
  const content = [...node.childNodes].map(inlineMarkdown).join("");
  switch (node.tagName) {
    case "BR": return "  \n";
    case "STRONG":
    case "B": return `**${content}**`;
    case "EM":
    case "I": return `*${content}*`;
    case "DEL":
    case "S": return `~~${content}~~`;
    case "CODE": return `\`${content}\``;
    case "A": {
      const href = node.getAttribute("href") || "";
      const title = node.getAttribute("title");
      return `[${content}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
    }
    default: return content;
  }
}

function serializeList(list: Element, depth = 0): string {
  const ordered = list.tagName === "OL";
  const start = ordered ? Number.parseInt(list.getAttribute("start") || "1", 10) : 1;
  const indent = "  ".repeat(depth);
  return [...list.children].filter((item) => item.tagName === "LI").map((item, index) => {
    const checkbox = item.querySelector(":scope > input[type=checkbox]");
    const task = checkbox instanceof HTMLInputElement
      ? `[${checkbox.checked ? "x" : " "}] `
      : "";
    const text = [...item.childNodes]
      .filter((node) => !(node instanceof Element && (node.tagName === "UL" || node.tagName === "OL" || node.matches("input[type=checkbox]"))))
      .map(inlineMarkdown).join("");
    const marker = ordered ? `${start + index}. ` : "- ";
    const children = [...item.children]
      .filter((child) => child.tagName === "UL" || child.tagName === "OL")
      .map((child) => serializeList(child, depth + 1))
      .filter(Boolean);
    return `${indent}${marker}${task}${checkbox ? text.trimStart() : text}${children.length ? `\n${children.join("\n")}` : ""}`;
  }).join("\n");
}

function serializeBlock(element: Element): string {
  if (element.tagName === "P" && !element.textContent?.trim()) return "";
  if (element.classList.contains("code-block")) {
    const language = element.querySelector(".code-block-header span")?.textContent.trim().toLowerCase() || "";
    const code = element.querySelector("pre code")?.textContent.replace(/\n$/, "") || "";
    return `\`\`\`${language === "code" ? "" : language}\n${code}\n\`\`\``;
  }
  if (element.tagName === "TABLE") {
    const rows = [...element.querySelectorAll("tr")].map((row) =>
      [...row.cells].map((cell) => escapeTablePipes(
        [...cell.childNodes].map(inlineMarkdown).join(""),
      ).replace(/ {2,}\n/g, "<br>")));
    if (!rows.length) return "";
    const headers = [...element.querySelectorAll<HTMLTableCellElement>("thead th")];
    const separator = rows[0].map((_cell, index) => {
      const alignment = headers[index]?.dataset.align;
      return alignment === "center" ? ":---:" : alignment === "right" ? "---:" : alignment === "left" ? ":---" : "---";
    });
    return [
      `| ${rows[0].join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  }
  if (element.tagName === "UL" || element.tagName === "OL") return serializeList(element);
  const content = [...element.childNodes].map(inlineMarkdown).join("");
  switch (element.tagName) {
    case "H1": return `# ${content}`;
    case "H2": return `## ${content}`;
    case "H3": return `### ${content}`;
    case "H4": return `#### ${content}`;
    case "H5": return `##### ${content}`;
    case "H6": return `###### ${content}`;
    case "BLOCKQUOTE": return [...element.children].map(serializeBlock).join("\n\n").split("\n").map((line) => `> ${line}`).join("\n");
    case "HR": return "---";
    default: return content;
  }
}

export function serializeMarkdown(editor: HTMLElement): string {
  const blocks = [...editor.children].map(serializeBlock).filter(Boolean);
  return blocks.join("\n\n").replace(/^\s+|\s+$/g, "");
}
