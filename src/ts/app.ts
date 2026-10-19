import { request } from "./api.js";
import { createEditor } from "./editor.js";
import { createSidebar } from "./sidebar.js";
import { errorMessage, requiredElement } from "./dom.js";
import type { AppConfig, CreateItemRequest, NoteDocument } from "./types.js";

const config = await request<AppConfig>("/config.json");
const treeElement = requiredElement<HTMLElement>("#file-tree");
const sidebarElement = requiredElement<HTMLElement>(".sidebar");
const welcomeElement = requiredElement<HTMLElement>("#welcome");
const editorView = requiredElement<HTMLElement>("#editor-view");
const editorElement = requiredElement<HTMLElement>("#editor");
const noteTitle = requiredElement<HTMLElement>("#note-title");
const toastElement = requiredElement<HTMLElement>("#toast");

let toastTimer = 0;

function showToast(message: string, isError = false): void {
  toastElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove("visible"), 2800);
}

const editor = createEditor({
  editor: editorElement,
  request,
  showToast,
  config,
});

async function openNote(path: string): Promise<void> {
  if (editor.getPath() && editor.getPath() !== path && editor.isDirty()) {
    await editor.save();
    if (editor.isDirty()) return;
  }
  try {
    const note = await request<NoteDocument>(`/api/file?path=${encodeURIComponent(path)}`);
    window.scrollTo(0, 0);
    editor.load(note.path, note.content);
    noteTitle.textContent = note.path.split("/").pop() ?? "";
    welcomeElement.hidden = true;
    editorView.hidden = false;
    sidebar.setSelected(note.path, "file");
  } catch (error) {
    showToast(errorMessage(error), true);
  }
}

async function relocate(source: string, destination: string): Promise<boolean> {
  const currentPath = editor.getPath();
  const selectedItem = sidebar.getSelected();
  const noteIsWithinSource = currentPath &&
    (currentPath === source || currentPath.startsWith(`${source}/`));

  try {
    if (noteIsWithinSource && editor.isDirty()) {
      await editor.save();
      if (editor.isDirty()) return false;
    }
    const response = await request<{ path: string }>("/api/item", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, destination }),
    });

    let nextNotePath = currentPath;
    if (noteIsWithinSource) {
        if (!currentPath) return false;
        nextNotePath = currentPath === source ? response.path : `${response.path}${currentPath.slice(source.length)}`;
        const note = await request<NoteDocument>(`/api/file?path=${encodeURIComponent(nextNotePath)}`);
        editor.load(note.path, note.content);
        noteTitle.textContent = note.path.split("/").pop() ?? "";
      }

      if (selectedItem && (selectedItem.path === source || selectedItem.path.startsWith(`${source}/`))) {
        const nextSelectedPath = selectedItem.path === source
        ? response.path
        : `${response.path}${selectedItem.path.slice(source.length)}`;
        await sidebar.refresh();
        sidebar.setSelected(nextSelectedPath, selectedItem.type);
      } else {
        await sidebar.refresh();
        if (noteIsWithinSource && nextNotePath) sidebar.setSelected(nextNotePath, "file");
      }
    showToast("Item moved");
    return true;
  } catch (error) {
    showToast(errorMessage(error), true);
    return false;
  }
}

const sidebar = createSidebar({
  treeElement,
  sidebarElement,
  showToast,
  openNote,
  relocate,
  config,
});

async function createItem({ type, folder, name }: CreateItemRequest): Promise<boolean> {
  const isNote = type === "note";
  if (isNote && editor.getPath() && editor.isDirty()) {
    await editor.save();
    if (editor.isDirty()) return false;
  }
  const filename = isNote && !/\.(md|markdown|txt)$/i.test(name)
    ? `${name}${config.notes.defaultNoteExtension}`
    : name;
  const path = folder ? `${folder}/${filename}` : filename;
  try {
    if (isNote) {
      await request("/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: "" }),
      });
    } else {
      await request("/api/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
    }
    await sidebar.refresh();
    if (isNote) await openNote(path);
    else sidebar.setSelected(path, "folder");
    showToast(isNote ? "Note created" : "Folder created");
    return true;
  } catch (error) {
    showToast(errorMessage(error), true);
    return false;
  }
}

requiredElement<HTMLButtonElement>("#new-note-button").addEventListener("click", () => sidebar.beginCreate("note", createItem));
requiredElement<HTMLButtonElement>("#new-folder-button").addEventListener("click", () => sidebar.beginCreate("folder", createItem));
requiredElement<HTMLButtonElement>("#welcome-new-note").addEventListener("click", () => sidebar.beginCreate("note", createItem));

sidebar.refresh().catch((error: unknown) => showToast(errorMessage(error), true));
