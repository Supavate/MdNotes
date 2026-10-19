export interface AppConfig {
  editor: {
    autoSaveDelayMs: number;
    convertCodeFenceOnEnter: boolean;
    removeEmptyCodeBlockOnBackspace: boolean;
    copyListsWithoutMarkers: boolean;
  };
  codeBlocks: {
    copyFeedbackMs: number;
    emptyLanguageLabel: string;
  };
  notes: {
    newNoteName: string;
    newFolderName: string;
    defaultNoteExtension: ".md" | ".markdown" | ".txt";
  };
}

export interface NoteFile {
  name: string;
  path: string;
  type: "file";
}

export interface NoteFolder {
  name: string;
  path: string;
  type: "folder";
  children: NoteTreeItem[];
}

export type NoteTreeItem = NoteFile | NoteFolder;

export interface NoteDocument {
  path: string;
  content: string;
}

export interface SelectedItem {
  path: string;
  type: NoteTreeItem["type"];
}

export interface CreateItemRequest {
  type: "note" | "folder";
  folder: string;
  name: string;
}
