/**
 * The parts of the File System Access API that TypeScript's DOM lib omits.
 *
 * `lib.dom.d.ts` already types `FileSystemDirectoryHandle`, `getFileHandle`,
 * `removeEntry`, `values()` and `createWritable()`. What it does not type is the
 * picker entry point and the permission methods, because those are still WICG
 * rather than WHATWG. Declaring the three we use here avoids taking on
 * `@types/wicg-file-system-access` for a handful of signatures.
 *
 * Everything below is Chromium-desktop only at runtime — `showDirectoryPicker`
 * is absent in Firefox, Safari and every mobile browser, so callers must feature
 * detect rather than trust these types.
 */

type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface DirectoryPickerOptions {
  /**
   * Chrome remembers the last directory chosen per id, so reusing one drops the
   * user back where they were instead of at their home folder.
   */
  id?: string;
  mode?: FileSystemPermissionMode;
  startIn?:
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos'
    | FileSystemHandle;
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
