# Noted — local Markdown workspace

Noted is a local web app for browsing and editing Markdown notes in the project's `data/` folder. It supports nested folders, a live Markdown preview, automatic saving, copyable code blocks, and creating, renaming, moving, and reordering notes.

## Build a Windows executable

From the project folder, run:

```powershell
npm install
npm run build
python -m pip install -r requirements-build.txt
python -m PyInstaller --noconfirm --clean --onefile --console --name MdNotes --distpath . --workpath build\pyinstaller --add-data "src\index.html;src" --add-data "src\styles.css;src" --add-data "src\app.bundle.js;src" --add-data "src\config.json;src" src\server.py
.\MdNotes.exe
```

This creates `MdNotes.exe` in the project folder. Run it there to use the existing `data\` folder and `data\.notes-order.json`; no note files need to be copied or moved. The executable reads an optional adjacent `config.json`, otherwise it uses the packaged default. The default port and search limit are controlled by `server.defaultPort` and `server.portSearchAttempts`.

## Run

1. Install Node.js if it is not already installed.
2. From this project folder, install the TypeScript build tools with `npm install`.
3. Compile the TypeScript frontend with `npm run build`.
4. Start the development server with `python src\server.py`.
5. Open the local URL printed in the terminal. The default port is `4073`; if occupied, the server searches the configured following ports.

Choose a note in the sidebar and type Markdown. Changes save automatically; **Ctrl+Z** undoes edits and **Ctrl+S** saves immediately.

Notes are still stored as files; no database is used. Re-run `npm run build` after changing TypeScript source. The editable settings in `src/config.json` take effect after reloading the app.

## Architecture

```text
Browser
  src/index.html + styles.css Page structure and styling
  src/ts/app.ts               App startup and UI coordination
  src/ts/api.ts               JSON API requests
  src/ts/editor.ts            Editable preview, autosave, and copy buttons
  src/ts/markdown.ts          Markdown rendering and serialization
  src/ts/sidebar.ts           Tree, rename, drag-and-drop, and ordering
  src/config.json             Common editor and creation settings
  src/app.bundle.js           Compiled browser bundle
  requirements-build.txt      PyInstaller build dependency
       | HTTP requests to the local server
       v
src/server.py                 Python standard-library HTTP server and file API
       | reads/writes
       v
data/                         Note files and their subfolders
```

- **Frontend:** `src/index.html` defines the workspace, `src/styles.css` styles it, and TypeScript source modules in `src/ts/` separate API access, Markdown conversion, editor behavior, and sidebar interactions. `npm run build` type-checks those modules and bundles them into the single browser-ready `src/app.bundle.js` file. The rendered note itself is the editor; edits keep the normal undo history and save automatically. The compact fixed sidebar expands on hover or keyboard focus. Double-click an item to rename it inline and press Enter to save; drag items onto folders to move them, or to a sibling position to reorder them.
- **Backend:** `src/server.py` serves the frontend and exposes a small JSON API for listing the tree, reading and saving notes, creating folders and notes, and moving or renaming items. It uses only Python's standard library.
- **Configuration:** `src/config.json` controls editor behavior, new note/folder defaults, and server startup. `server.defaultPort` sets the preferred port; `server.portSearchAttempts` bounds the forward search if it is occupied. In the executable build, an adjacent `config.json` takes precedence so settings can be changed without rebuilding.
- **Storage:** Notes remain ordinary files inside `data/`; no database is used. The sidebar includes `.md`, `.markdown`, and `.txt` files. Manual sidebar ordering is saved in `data/.notes-order.json`, so it can sync with a separate private notes repository.
- **Local access:** The server binds to `127.0.0.1`, so it is available from the same computer rather than being exposed to the local network. API paths are checked to keep file operations inside `data/`.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/tree` | List note files and folders under `data/`. |
| `GET` | `/api/file?path=...` | Read a note. |
| `POST` | `/api/file` | Create a note. |
| `PUT` | `/api/file` | Save changes to a note. |
| `POST` | `/api/folder` | Create a folder. |
| `PATCH` | `/api/item` | Move or rename a note or folder. |
| `PUT` | `/api/order` | Save the sidebar order for one folder. |

The editor supports ATX and Setext headings, paragraphs, nested emphasis, escaped punctuation, hard and soft line breaks, nested ordered and unordered lists, task checkboxes, blockquotes, horizontal rules, inline/reference/autolinks with titles, inline code, backtick and tilde fenced code blocks, indented code blocks, and pipe tables with left, center, or right alignment and explicit `<br>` line breaks in cells. Typing `#` through `######`, followed by a space and heading text, then pressing **Enter** converts the line into the matching heading and starts a paragraph below it. Typing a pipe-delimited header row and pressing **Enter** creates a table, automatically generating a `| --- |` separator for each header and placing the cursor in the first data cell. Ordered-list start numbers and task state are preserved when saving. Table editing is keyboard-only: **Enter** inserts a line break in the current cell; **Ctrl+Enter** inserts a row after the current row and keeps the same column selected; **Shift+Enter** exits after the table; **Ctrl+Backspace** deletes the current row, or the table if it is the last body row. **Tab** moves between cells and appends a row when pressed in the last cell. Each fenced code block has a **Copy** button. The page scrolls with the note instead of trapping document content inside an editor card. Markdown is rendered by a lightweight built-in renderer rather than a full CommonMark implementation.

Not currently supported: images, raw HTML, footnotes, definition lists, deeply nested inline delimiter edge cases, and block-level Markdown nested inside table cells. The renderer is still a focused subset rather than full CommonMark/GFM conformance.
