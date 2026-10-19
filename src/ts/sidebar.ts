import { request } from "./api.js";
import type { AppConfig, CreateItemRequest, NoteTreeItem, SelectedItem } from "./types.js";

interface SidebarOptions {
  treeElement: HTMLElement;
  sidebarElement: HTMLElement;
  showToast: (message: string, isError?: boolean) => void;
  openNote: (path: string) => Promise<void>;
  relocate: (source: string, destination: string) => Promise<boolean>;
  config: AppConfig;
}

export function createSidebar({
  treeElement,
  sidebarElement,
  showToast,
  openNote,
  relocate,
  config,
}: SidebarOptions) {
  let tree: NoteTreeItem[] = [];
  let selectedItem: SelectedItem | null = null;
  let draggedPath: string | null = null;

  function clearDropIndicators(): void {
    treeElement.querySelectorAll(".drop-before, .drop-after, .drop-inside")
      .forEach((element) => element.classList.remove("drop-before", "drop-after", "drop-inside"));
  }

  function endDrag(): void {
    draggedPath = null;
    clearDropIndicators();
    treeElement.querySelectorAll(".dragging")
      .forEach((element) => element.classList.remove("dragging"));
  }

  document.addEventListener("dragend", endDrag, true);
  document.addEventListener("drop", endDrag);
  window.addEventListener("blur", endDrag);

  function setSelected(path: string, type: SelectedItem["type"]): void {
    selectedItem = { path, type };
    treeElement.querySelectorAll<HTMLElement>(".tree-row.selected").forEach((row) => row.classList.remove("selected"));
    const row = [...treeElement.querySelectorAll<HTMLElement>(".tree-row")].find((item) => item.dataset.path === path);
    if (row) row.classList.add("selected");
  }

  function findItem(path: string, items: NoteTreeItem[] = tree): NoteTreeItem | null {
    for (const item of items) {
      if (item.path === path) return item;
      if (item.type === "folder") {
        const nested = findItem(path, item.children);
        if (nested) return nested;
      }
    }
    return null;
  }

  function itemsInFolder(path: string): NoteTreeItem[] | null {
    if (!path) return tree;
    const folder = findItem(path);
    return folder?.type === "folder" ? folder.children : null;
  }

  function itemParent(path: string): string {
    return path.split("/").slice(0, -1).join("/");
  }

  function beginCreate(
    type: CreateItemRequest["type"],
    onCreate: (payload: CreateItemRequest) => Promise<boolean>,
  ): void {
    const folder = selectedItem?.type === "folder"
      ? selectedItem.path
      : selectedItem ? itemParent(selectedItem.path) : "";
    const folderRow = [...treeElement.querySelectorAll<HTMLElement>(".tree-row")]
      .find((row) => row.dataset.path === folder);
    const parentContainer = folder
      ? folderRow?.closest("details")?.querySelector<HTMLElement>(".tree-folder-content") ?? null
      : treeElement;
    if (!parentContainer) {
      showToast("Could not find the selected folder.", true);
      return;
    }
    parentContainer.closest("details")?.setAttribute("open", "");
    const row = document.createElement("div");
    row.className = "tree-row creating-row";
    row.innerHTML = `<span class="tree-icon" aria-hidden="true">${type === "note" ? "▤" : "▾"}</span><input class="rename-input" type="text" aria-label="New ${type} name">`;
    const input = row.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Could not create the inline name field.");
    input.value = type === "note" ? config.notes.newNoteName : config.notes.newFolderName;
    input.draggable = false;
    const emptyState = parentContainer.querySelector<HTMLElement>(":scope > .tree-empty");
    if (emptyState) emptyState.hidden = true;
    parentContainer.append(row);
    sidebarElement.classList.add("renaming");
    input.focus();
    input.select();
    let finished = false;

    const cancel = () => {
      if (finished) return;
      finished = true;
      row.remove();
      if (emptyState?.isConnected) emptyState.hidden = false;
      sidebarElement.classList.remove("renaming");
    };

    input.addEventListener("click", (event: MouseEvent) => event.stopPropagation());
    input.addEventListener("keydown", async (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const name = input.value.trim();
      if (!name || name === "." || name === ".." || /[\\/:]/.test(name)) {
        showToast("Enter a valid name without slashes or colons.", true);
        input.focus();
        return;
      }
      input.disabled = true;
      const created = await onCreate({ type, folder, name });
      if (!created && input.isConnected) {
        input.disabled = false;
        input.focus();
        input.select();
      } else {
        finished = true;
        sidebarElement.classList.remove("renaming");
      }
    });
    input.addEventListener("blur", () => {
      if (!finished) cancel();
    }, { once: true });
  }

  async function reorderItems(folder: string, sourcePath: string, targetPath: string, after: boolean): Promise<void> {
    const items = itemsInFolder(folder);
    if (!items) return;
    const sourceIndex = items.findIndex((item) => item.path === sourcePath);
    if (sourceIndex < 0) return;
    const [moved] = items.splice(sourceIndex, 1);
    const targetIndex = items.findIndex((item) => item.path === targetPath);
    if (targetIndex < 0) {
      items.splice(sourceIndex, 0, moved);
      return;
    }
    items.splice(targetIndex + Number(after), 0, moved);
    try {
      await request("/api/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, items: items.map((item) => item.name) }),
      });
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
      await refresh();
    }
  }

  function renameInline(item: NoteTreeItem, row: HTMLElement): void {
    if (row.querySelector(".rename-input")) return;
    sidebarElement.classList.add("renaming");
    const label = row.querySelector<HTMLElement>(".tree-label");
    if (!label) return;
    const originalName = item.name;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.value = originalName;
    input.setAttribute("aria-label", `Rename ${originalName}`);
    input.draggable = false;
    label.replaceWith(input);
    input.focus();
    input.select();
    let renameFinished = false;

    const cancel = () => {
      if (renameFinished || !input.isConnected) return;
      renameFinished = true;
      const restoredLabel = document.createElement("span");
      restoredLabel.className = "tree-label";
      restoredLabel.textContent = originalName.replace(/\.(md|markdown|txt)$/i, "");
      input.replaceWith(restoredLabel);
      sidebarElement.classList.remove("renaming");
    };

    input.addEventListener("click", (event: MouseEvent) => event.stopPropagation());
    input.addEventListener("dblclick", (event: MouseEvent) => event.stopPropagation());
    input.addEventListener("keydown", async (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const name = input.value.trim();
        if (!name || name === "." || name === ".." || /[\\/:]/.test(name)) {
          showToast("Enter a valid name without slashes or colons.", true);
          input.focus();
          return;
        }
        const extension = originalName.match(/\.(md|markdown|txt)$/i)?.[0] || "";
        const normalizedName = item.type === "file" && !/\.(md|markdown|txt)$/i.test(name)
          ? `${name}${extension}`
          : name;
        const destination = [...item.path.split("/").slice(0, -1), normalizedName].filter(Boolean).join("/");
        if (destination === item.path) {
          cancel();
          return;
        }
        input.disabled = true;
        const moved = await relocate(item.path, destination);
        if (!moved) {
          input.disabled = false;
          input.focus();
          input.select();
        } else {
          renameFinished = true;
          sidebarElement.classList.remove("renaming");
        }
      }
    });
    input.addEventListener("blur", () => {
      if (input.isConnected) cancel();
    }, { once: true });
  }

  async function dropOnItem(event: DragEvent, item: NoteTreeItem, row: HTMLElement): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const sourcePath = event.dataTransfer?.getData("text/plain") || draggedPath;
    endDrag();
    if (row.querySelector(".rename-input")) return;
    if (!sourcePath || sourcePath === item.path) return;
    const source = findItem(sourcePath);
    if (!source) return;
    const bounds = row.getBoundingClientRect();
    const position = (event.clientY - bounds.top) / bounds.height;
    const dropInside = item.type === "folder" && position > 0.28 && position < 0.72;
    if (dropInside) {
      if (itemParent(source.path) === item.path) return;
      if (source.type === "folder" && item.path.startsWith(`${source.path}/`)) {
        showToast("A folder cannot be moved inside itself.", true);
        return;
      }
      await relocate(source.path, `${item.path}/${source.path.split("/").pop()}`);
      return;
    }
    const destinationFolder = itemParent(item.path);
    if (itemParent(source.path) === destinationFolder) {
      await reorderItems(destinationFolder, source.path, item.path, position >= 0.5);
      return;
    }
    const destination = [destinationFolder, source.path.split("/").pop()].filter(Boolean).join("/");
    if (!await relocate(source.path, destination)) return;
    await reorderItems(destinationFolder, destination, item.path, position >= 0.5);
  }

  function attachRowActions(row: HTMLElement, item: NoteTreeItem): void {
    row.draggable = true;
    row.addEventListener("dblclick", (event: MouseEvent) => {
      event.preventDefault();
      setSelected(item.path, item.type);
      row.blur();
      renameInline(item, row);
    });
    row.addEventListener("dragstart", (event: DragEvent) => {
      draggedPath = item.path;
      row.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.path);
      }
    });
    row.addEventListener("dragend", endDrag);
    row.addEventListener("dragover", (event: DragEvent) => {
      clearDropIndicators();
      if (!draggedPath || draggedPath === item.path) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      row.classList.remove("drop-before", "drop-after", "drop-inside");
      const bounds = row.getBoundingClientRect();
      const position = (event.clientY - bounds.top) / bounds.height;
      if (item.type === "folder" && position > 0.28 && position < 0.72) {
        row.classList.add("drop-inside");
      } else {
        row.classList.add(position < 0.5 ? "drop-before" : "drop-after");
      }
    });
    row.addEventListener("dragleave", (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget)) {
        row.classList.remove("drop-before", "drop-after", "drop-inside");
      }
    });
    row.addEventListener("drop", (event: DragEvent) => dropOnItem(event, item, row));
  }

  function activateRow(row: HTMLElement, item: NoteTreeItem): void {
    if (item.type === "folder") {
      setSelected(item.path, item.type);
      const details = row.closest("details");
      if (details) details.open = !details.open;
    } else {
      openNote(item.path);
    }
  }

  function buildTree(items: NoteTreeItem[], container: HTMLElement): void {
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = "No notes here yet";
      container.append(empty);
      return;
    }
    for (const item of items) {
      if (item.type === "folder") {
        const details = document.createElement("details");
        details.className = "tree-folder";
        details.open = true;
        const summary = document.createElement("summary");
        const row = document.createElement("div");
        row.className = "tree-row";
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.dataset.path = item.path;
        row.title = item.name;
        row.setAttribute("aria-label", `Folder ${item.name}`);
        row.innerHTML = '<span class="tree-icon folder-chevron" aria-hidden="true">›</span><span class="tree-label"></span>';
        const label = row.querySelector<HTMLElement>(".tree-label");
        if (label) label.textContent = item.name;
        row.addEventListener("click", (event: MouseEvent) => {
          event.preventDefault();
          activateRow(row, item);
          if (event.detail > 0) row.blur();
        });
        row.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateRow(row, item);
          }
        });
        attachRowActions(row, item);
        summary.append(row);
        const children = document.createElement("div");
        children.className = "tree-folder-children";
        const content = document.createElement("div");
        content.className = "tree-folder-content";
        buildTree(item.children, content);
        children.append(content);
        details.append(summary, children);
        container.append(details);
      } else {
        const row = document.createElement("div");
        row.className = "tree-row";
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.dataset.path = item.path;
        row.title = item.name;
        row.setAttribute("aria-label", `Note ${item.name}`);
        row.innerHTML = '<span class="tree-icon" aria-hidden="true">▤</span><span class="tree-label"></span>';
        const label = row.querySelector<HTMLElement>(".tree-label");
        if (label) label.textContent = item.name.replace(/\.(md|markdown|txt)$/i, "");
        row.addEventListener("click", (event: MouseEvent) => {
          activateRow(row, item);
          if (event.detail > 0) row.blur();
        });
        row.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateRow(row, item);
          }
        });
        attachRowActions(row, item);
        container.append(row);
      }
    }
  }

  async function refresh(): Promise<void> {
    tree = await request<NoteTreeItem[]>("/api/tree");
    treeElement.replaceChildren();
    buildTree(tree, treeElement);
    const currentSelection = selectedItem;
    if (currentSelection) {
      const row = [...treeElement.querySelectorAll<HTMLElement>(".tree-row")]
        .find((item) => item.dataset.path === currentSelection.path);
      if (row) row.classList.add("selected");
      else selectedItem = null;
    }
  }

  return {
    getSelected: (): SelectedItem | null => selectedItem,
    getTree: (): NoteTreeItem[] => tree,
    beginCreate,
    refresh,
    selectedFolder(): string {
      if (!selectedItem) return "";
      return selectedItem.type === "folder"
        ? selectedItem.path
        : selectedItem.path.split("/").slice(0, -1).join("/");
    },
    setSelected,
  };
}
