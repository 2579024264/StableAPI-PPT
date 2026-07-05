import { registerLocalFileObjectUrl, toLocalFileUrl } from './localFileUrls';

export type LocalFileKind =
  | 'reference'
  | 'template'
  | 'material'
  | 'page-image'
  | 'export'
  | 'temp';

export type LocalFileStorageBackend = 'opfs' | 'indexeddb';

export interface LocalFileRecord {
  id: string;
  kind: LocalFileKind;
  name: string;
  type: string;
  size: number;
  storage: LocalFileStorageBackend;
  createdAt: string;
  updatedAt: string;
  projectId?: string | null;
  pageId?: string | null;
  version?: number | null;
  caption?: string | null;
  opfsPath?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PutLocalFileOptions {
  id?: string;
  kind: LocalFileKind;
  projectId?: string | null;
  pageId?: string | null;
  version?: number | null;
  caption?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListLocalFilesOptions {
  kind?: LocalFileKind;
  projectId?: string | null | 'all';
  pageId?: string | null;
}

const DB_NAME = 'banana-slides-local-files';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const BLOB_STORE = 'blobs';
const OPFS_ROOT = 'banana-slides';

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const randomId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const extensionFromName = (name: string): string => {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
};

class BrowserLocalFileStore {
  private dbPromise?: Promise<IDBDatabase>;

  async isAvailable(): Promise<boolean> {
    return typeof indexedDB !== 'undefined';
  }

  async putFile(file: File, options: PutLocalFileOptions): Promise<LocalFileRecord> {
    return this.putBlob(file, file.name, file.type, options);
  }

  async putBlob(
    blob: Blob,
    name: string,
    type: string | undefined,
    options: PutLocalFileOptions,
  ): Promise<LocalFileRecord> {
    const id = options.id || randomId();
    const now = new Date().toISOString();
    const normalizedType = type || blob.type || 'application/octet-stream';
    let storage: LocalFileStorageBackend = 'indexeddb';
    let opfsPath: string | null = null;

    try {
      opfsPath = await this.writeToOpfs(id, name, blob);
      storage = 'opfs';
      await this.deleteIndexedDbBlob(id).catch(() => undefined);
    } catch {
      await this.writeIndexedDbBlob(id, blob);
    }

    const record: LocalFileRecord = {
      id,
      kind: options.kind,
      name,
      type: normalizedType,
      size: blob.size,
      storage,
      createdAt: now,
      updatedAt: now,
      projectId: options.projectId ?? null,
      pageId: options.pageId ?? null,
      version: options.version ?? null,
      caption: options.caption ?? null,
      opfsPath,
      metadata: options.metadata,
    };

    await this.writeRecord(record);
    return record;
  }

  async getRecord(id: string): Promise<LocalFileRecord | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(FILE_STORE, 'readonly');
    return requestToPromise<LocalFileRecord | undefined>(tx.objectStore(FILE_STORE).get(id));
  }

  async listFiles(options: ListLocalFilesOptions = {}): Promise<LocalFileRecord[]> {
    const db = await this.openDb();
    const tx = db.transaction(FILE_STORE, 'readonly');
    const records = await requestToPromise<LocalFileRecord[]>(
      tx.objectStore(FILE_STORE).getAll(),
    );

    return records
      .filter((record) => {
        if (options.kind && record.kind !== options.kind) return false;
        if (options.projectId && options.projectId !== 'all' && record.projectId !== options.projectId) {
          return false;
        }
        if (options.projectId === null && record.projectId !== null) return false;
        if (options.pageId && record.pageId !== options.pageId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    const record = await this.getRecord(id);
    if (!record) return undefined;

    if (record.storage === 'opfs' && record.opfsPath) {
      try {
        return await this.readFromOpfs(record.opfsPath);
      } catch {
        return this.readIndexedDbBlob(id);
      }
    }

    return this.readIndexedDbBlob(id);
  }

  async getFile(id: string): Promise<File | undefined> {
    const record = await this.getRecord(id);
    const blob = record ? await this.getBlob(id) : undefined;
    if (!record || !blob) return undefined;
    return new File([blob], record.name, { type: record.type || blob.type });
  }

  async createObjectUrl(id: string): Promise<string | undefined> {
    const blob = await this.getBlob(id);
    if (!blob) return undefined;
    const objectUrl = URL.createObjectURL(blob);
    registerLocalFileObjectUrl(toLocalFileUrl(id), objectUrl);
    return objectUrl;
  }

  async deleteFile(id: string): Promise<void> {
    const record = await this.getRecord(id);
    if (record?.opfsPath) {
      await this.deleteFromOpfs(record.opfsPath).catch(() => undefined);
    }

    const db = await this.openDb();
    const tx = db.transaction([FILE_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(FILE_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    await txDone(tx);
  }

  async clearProject(projectId: string): Promise<void> {
    const records = await this.listFiles({ projectId });
    await Promise.all(records.map((record) => this.deleteFile(record.id)));
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(FILE_STORE)) {
            const fileStore = db.createObjectStore(FILE_STORE, { keyPath: 'id' });
            fileStore.createIndex('kind', 'kind');
            fileStore.createIndex('projectId', 'projectId');
            fileStore.createIndex('pageId', 'pageId');
            fileStore.createIndex('createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains(BLOB_STORE)) {
            db.createObjectStore(BLOB_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  private async writeRecord(record: LocalFileRecord): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.objectStore(FILE_STORE).put(record);
    await txDone(tx);
  }

  private async writeIndexedDbBlob(id: string, blob: Blob): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).put(blob, id);
    await txDone(tx);
  }

  private async readIndexedDbBlob(id: string): Promise<Blob | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(BLOB_STORE, 'readonly');
    return requestToPromise<Blob | undefined>(tx.objectStore(BLOB_STORE).get(id));
  }

  private async deleteIndexedDbBlob(id: string): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).delete(id);
    await txDone(tx);
  }

  private async getOpfsRoot(create: boolean): Promise<any> {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<any>;
    };
    if (!storage?.getDirectory) {
      throw new Error('OPFS is not available');
    }
    const root = await storage.getDirectory();
    return root.getDirectoryHandle(OPFS_ROOT, { create });
  }

  private async writeToOpfs(id: string, name: string, blob: Blob): Promise<string> {
    const root = await this.getOpfsRoot(true);
    const filename = `${id}${extensionFromName(name)}`;
    const handle = await root.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return filename;
  }

  private async readFromOpfs(path: string): Promise<Blob> {
    const root = await this.getOpfsRoot(false);
    const handle = await root.getFileHandle(path, { create: false });
    const file = await handle.getFile();
    return file;
  }

  private async deleteFromOpfs(path: string): Promise<void> {
    const root = await this.getOpfsRoot(false);
    await root.removeEntry(path);
  }
}

export const localFileStore = new BrowserLocalFileStore();
