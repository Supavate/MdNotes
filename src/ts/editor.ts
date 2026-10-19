import { renderCodeBlock, renderMarkdown, renderMarkdownTableHeader, serializeMarkdown } from "./markdown.js";
import { errorMessage } from "./dom.js";
import type { AppConfig } from "./types.js";

interface EditorOptions {
  editor: HTMLElement;
  request: typeof import("./api.js").request;
  showToast: (message: string, isError?: boolean) => void;
  config: AppConfig;
}

function copiedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) {
    return [...node.childNodes].map(copiedText).join("");
  }
  if (node.tagName === "BR") return "\n";
  const children = [...node.childNodes];
  if (node.tagName === "UL" || node.tagName === "OL") {
    return children.map(copiedText).join("\n");
  }
  const content = children.map(copiedText).join("");
  if (/^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(node.tagName)) return `${content}\n`;
  return content;
}

export function createEditor({ editor, request, showToast, config }: EditorOptions) {
  let currentPath: string | null = null;
  let savedContent = "";
  let saveTimer: number | undefined;
  let saveQueue: Promise<void> = Promise.resolve();

  function getContent(): string {
    return serializeMarkdown(editor);
  }

  function isDirty(): boolean {
    return getContent() !== savedContent;
  }

  async function save(): Promise<void> {
    const content = getContent();
    const path = currentPath;
    if (!path || content === savedContent) return saveQueue;
    clearTimeout(saveTimer);
    const operation = saveQueue.then(async () => {
      try {
        await request("/api/file", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content }),
        });
        if (currentPath === path) {
          savedContent = content;
          if (isDirty()) scheduleSave();
        }
      } catch (error) {
        showToast(errorMessage(error), true);
      }
    });
    saveQueue = operation;
    return operation;
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    if (!currentPath || !isDirty()) return;
    saveTimer = setTimeout(save, config.editor.autoSaveDelayMs);
  }

  function load(path: string, content: string): void {
    clearTimeout(saveTimer);
    currentPath = path;
    savedContent = content;
    editor.innerHTML = content.trim()
      ? renderMarkdown(content, config.codeBlocks.emptyLanguageLabel)
      : '<p data-placeholder="Start writing…"><br></p>';
  }

  function caretBlock(selector: string): HTMLElement | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return null;
    const container = selection.getRangeAt(0).startContainer;
    const element = container instanceof Element ? container : container.parentElement;
    const block = element?.closest<HTMLElement>(selector);
    return block && editor.contains(block) ? block : null;
  }

  function focusParagraph(paragraph: HTMLParagraphElement): void {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) return;
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function leaveTable(table: HTMLTableElement): void {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";
    table.after(paragraph);
    focusParagraph(paragraph);
    scheduleSave();
  }

  function removeTable(table: HTMLTableElement): void {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";
    table.before(paragraph);
    table.remove();
    focusParagraph(paragraph);
    scheduleSave();
  }

  function insertTableRow(table: HTMLTableElement, currentCell: HTMLTableCellElement, append = false): void {
    const currentRow = currentCell.parentElement;
    const headerCells = [...table.tHead?.rows[0]?.cells ?? []];
    const body = table.tBodies[0];
    if (!(currentRow instanceof HTMLTableRowElement) || !body || !headerCells.length) return;
    const row = body.insertRow(append ? -1 : currentRow.sectionRowIndex + (currentRow.parentElement === body ? 1 : 0));
    headerCells.forEach((header) => {
      const cell = row.insertCell();
      if (header.dataset.align) cell.dataset.align = header.dataset.align;
      cell.innerHTML = "<br>";
    });
    const columnIndex = append ? 0 : Math.min(currentCell.cellIndex, row.cells.length - 1);
    const range = document.createRange();
    range.selectNodeContents(row.cells[columnIndex]);
    range.collapse(true);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    scheduleSave();
  }

  function handleTableKeydown(event: KeyboardEvent): boolean {
    const cell = caretBlock("td, th");
    if (!cell) return false;
    const table = cell.closest("table");
    if (!table) return false;

    if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      leaveTable(table);
      return true;
    }
    if (event.key === "Backspace" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
      event.preventDefault();
      const row = cell.closest("tr");
      if (!row || row.parentElement === table.tHead) {
        removeTable(table);
        return true;
      }
      if (table.tBodies[0].rows.length <= 1) {
        removeTable(table);
        return true;
      }
      const focusRow = row.previousElementSibling ?? row.nextElementSibling;
      const focusCell = focusRow?.querySelector<HTMLTableCellElement>("td, th");
      row.remove();
      if (focusCell) {
        const range = document.createRange();
        range.selectNodeContents(focusCell);
        range.collapse(true);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      scheduleSave();
      return true;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
      event.preventDefault();
      insertTableRow(table, cell as HTMLTableCellElement);
      return true;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !selection.getRangeAt(0).collapsed) return false;
      event.preventDefault();
      const range = selection.getRangeAt(0);
      range.insertNode(document.createElement("br"));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      scheduleSave();
      return true;
    }
    if (event.key === "Tab") {
      const cells = [...table.querySelectorAll<HTMLTableCellElement>("th, td")];
      const cellIndex = cells.indexOf(cell as HTMLTableCellElement);
      const next = cells[cellIndex + (event.shiftKey ? -1 : 1)];
      event.preventDefault();
      if (next) {
        const range = document.createRange();
        range.selectNodeContents(next);
        range.collapse(!event.shiftKey);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else if (event.shiftKey) {
        const firstCell = cells[0];
        if (firstCell) {
          const range = document.createRange();
          range.selectNodeContents(firstCell);
          range.collapse(true);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      } else {
        insertTableRow(table, cell as HTMLTableCellElement, true);
      }
      return true;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !selection.getRangeAt(0).collapsed) return false;
      event.preventDefault();
      const range = selection.getRangeAt(0);
      range.insertNode(document.createElement("br"));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      scheduleSave();
      return true;
    }
    return false;
  }

  function insertCodeBlockFromFence(event: KeyboardEvent): boolean {
    if (!config.editor.convertCodeFenceOnEnter) return false;
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) return false;
    const paragraph = caretBlock("p");
    const selection = window.getSelection();
    if (!paragraph || !selection?.rangeCount || paragraph.childNodes.length !== 1) return false;
    const range = selection.getRangeAt(0);
    const textNode = paragraph.firstChild;
    if (!(textNode instanceof Text) || range.startContainer !== textNode ||
        range.startOffset !== textNode.textContent.length) return false;
    const fence = paragraph.textContent.match(/^```([^\s`]*)$/);
    if (!fence) return false;

    event.preventDefault();
    const template = document.createElement("template");
    template.innerHTML = renderCodeBlock(
      fence[1],
      "",
      config.codeBlocks.emptyLanguageLabel,
    );
    const codeBlock = template.content.firstElementChild;
    if (!(codeBlock instanceof HTMLElement)) throw new Error("Could not create a code block.");
    paragraph.replaceWith(codeBlock);
    const code = codeBlock.querySelector("pre code");
    if (!code) throw new Error("Could not create a code block.");
    const caret = document.createRange();
    caret.setStart(code, 0);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    scheduleSave();
    return true;
  }

  function insertTableFromHeader(event: KeyboardEvent): boolean {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const paragraph = caretBlock("p");
    const selection = window.getSelection();
    if (!paragraph || !selection?.rangeCount || paragraph.childNodes.length !== 1) return false;
    const range = selection.getRangeAt(0);
    const textNode = paragraph.firstChild;
    if (!(textNode instanceof Text) || range.startContainer !== textNode ||
        range.startOffset !== textNode.textContent.length) return false;
    const tableHtml = renderMarkdownTableHeader(textNode.textContent);
    if (!tableHtml) return false;

    event.preventDefault();
    const template = document.createElement("template");
    template.innerHTML = tableHtml;
    const table = template.content.firstElementChild;
    if (!(table instanceof HTMLTableElement)) throw new Error("Could not create a Markdown table.");
    paragraph.replaceWith(table);
    const firstCell = table.querySelector("tbody td");
    if (!firstCell) throw new Error("Could not create the first table cell.");
    const caret = document.createRange();
    caret.selectNodeContents(firstCell);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    scheduleSave();
    return true;
  }

  function insertHeadingFromMarkdown(event: KeyboardEvent): boolean {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const paragraph = caretBlock("p");
    const selection = window.getSelection();
    if (!paragraph || paragraph.childNodes.length !== 1 || !selection?.rangeCount) return false;
    const textNode = paragraph.firstChild;
    const range = selection.getRangeAt(0);
    if (!(textNode instanceof Text) || range.startContainer !== textNode ||
        range.startOffset !== textNode.textContent.length) return false;
    const heading = textNode.textContent.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) return false;

    event.preventDefault();
    const template = document.createElement("template");
    template.innerHTML = renderMarkdown(textNode.textContent);
    const headingElement = template.content.firstElementChild;
    if (!(headingElement instanceof HTMLHeadingElement)) {
      throw new Error("Could not create a Markdown heading.");
    }
    const nextParagraph = document.createElement("p");
    nextParagraph.innerHTML = "<br>";
    paragraph.replaceWith(headingElement, nextParagraph);
    focusParagraph(nextParagraph);
    scheduleSave();
    return true;
  }

  function leaveCodeBlock(event: KeyboardEvent): boolean {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
    const codeBlock = caretBlock(".code-block");
    if (!codeBlock) return false;

    event.preventDefault();
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";
    codeBlock.after(paragraph);
    focusParagraph(paragraph);
    scheduleSave();
    return true;
  }

  function removeEmptyCodeBlock(event: KeyboardEvent): boolean {
    if (!config.editor.removeEmptyCodeBlockOnBackspace) return false;
    if (event.key !== "Backspace" || event.shiftKey || event.ctrlKey || event.metaKey) return false;
    const code = caretBlock(".code-block pre code");
    if (!code || code.textContent) return false;

    event.preventDefault();
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";
    const codeBlock = code.closest(".code-block");
    if (!codeBlock) return false;
    codeBlock.replaceWith(paragraph);
    const caret = document.createRange();
    caret.setStart(paragraph, 0);
    caret.collapse(true);
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(caret);
    scheduleSave();
    return true;
  }

  function startParagraphAfterHeading(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const block = range.startContainer instanceof Element
      ? range.startContainer.closest("h1, h2, h3, h4, h5, h6")
      : range.startContainer.parentElement?.closest("h1, h2, h3, h4, h5, h6");
    if (!block || !editor.contains(block)) return;

    event.preventDefault();
    const paragraph = document.createElement("p");
    if (!block.textContent?.trim()) {
      block.replaceWith(paragraph);
      paragraph.innerHTML = "<br>";
      const emptyCaret = document.createRange();
      emptyCaret.setStart(paragraph, 0);
      emptyCaret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(emptyCaret);
      scheduleSave();
      return;
    }

    const remainingRange = document.createRange();
    remainingRange.setStart(range.startContainer, range.startOffset);
    remainingRange.setEnd(block, block.childNodes.length);
    const remainingContent = remainingRange.extractContents();
    if (remainingContent.childNodes.length) paragraph.append(remainingContent);
    else paragraph.innerHTML = "<br>";
    block.after(paragraph);

    const caret = document.createRange();
    caret.setStart(paragraph, 0);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    scheduleSave();
  }

  async function copyCode(event: MouseEvent): Promise<void> {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>(".copy-code-button")
      : null;
    if (!button) return;
    const copyIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 3V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
    try {
      const code = button.closest(".code-block")?.querySelector("pre code")?.textContent || "";
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser context.");
      }
      await navigator.clipboard.writeText(code);
      button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      button.setAttribute("aria-label", "Copied");
      button.title = "Copied";
      setTimeout(() => {
        if (button.isConnected) {
          button.innerHTML = copyIcon;
          button.setAttribute("aria-label", "Copy code");
          button.title = "Copy code";
        }
      }, config.codeBlocks.copyFeedbackMs);
    } catch (error) {
      showToast(`Could not copy code: ${errorMessage(error)}`, true);
    }
  }

  function copyListWithoutMarkers(event: ClipboardEvent): void {
    if (!config.editor.copyListsWithoutMarkers) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const fragment = range.cloneContents();
    if (!fragment.querySelector("ul, ol")) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", copiedText(fragment).trim());
  }

  editor.addEventListener("input", scheduleSave);
  editor.addEventListener("blur", () => {
    if (isDirty()) save();
  });
  editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
      return;
    }
    if (leaveCodeBlock(event) || handleTableKeydown(event)) return;
    if (insertCodeBlockFromFence(event) || insertTableFromHeader(event) ||
        insertHeadingFromMarkdown(event) || removeEmptyCodeBlock(event)) return;
    startParagraphAfterHeading(event);
  });
  editor.addEventListener("click", copyCode);
  editor.addEventListener("copy", copyListWithoutMarkers);
  window.addEventListener("beforeunload", (event) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  return {
    getContent,
    getPath: () => currentPath,
    isDirty,
    load,
    save,
  };
}
