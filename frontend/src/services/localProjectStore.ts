import type { CreateProjectRequest, Page, Project } from '@/types';
import { localFileStore } from './localFileStore';

const DB_NAME = 'banana-slides-local-projects';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';

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

const nowIso = (): string => new Date().toISOString();

const normalizeProjectIds = (project: Project): Project => ({
  ...project,
  id: project.id || project.project_id,
  project_id: project.project_id || project.id || randomId(),
  pages: (project.pages || []).map((page) => ({
    ...page,
    id: page.id || page.page_id,
    page_id: page.page_id || page.id || randomId(),
  })),
});

const titleFromRequest = (data: CreateProjectRequest): string => {
  const source = data.outline_text || data.description_text || data.idea_prompt || '';
  const firstLine = source.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return '未命名项目';
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}...` : firstLine;
};

class BrowserLocalProjectStore {
  private dbPromise?: Promise<IDBDatabase>;

  async createProject(data: CreateProjectRequest): Promise<Project> {
    const now = nowIso();
    const id = randomId();
    const project: Project = normalizeProjectIds({
      project_id: id,
      id,
      project_title: titleFromRequest(data),
      idea_prompt: data.idea_prompt || '',
      outline_text: data.outline_text,
      description_text: data.description_text,
      creation_type: data.description_text ? 'descriptions' : data.outline_text ? 'outline' : 'idea',
      template_style: data.template_style,
      image_aspect_ratio: data.image_aspect_ratio,
      export_extractor_method: 'hybrid',
      export_inpaint_method: 'hybrid',
      export_allow_partial: true,
      enable_icon_subject_extraction: false,
      status: 'DRAFT',
      pages: [],
      created_at: now,
      updated_at: now,
    });
    await this.putProject(project);
    return project;
  }

  async putProject(project: Project): Promise<Project> {
    const normalized = normalizeProjectIds({
      ...project,
      updated_at: nowIso(),
    });
    const db = await this.openDb();
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).put(normalized);
    await txDone(tx);
    return normalized;
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const project = await requestToPromise<Project | undefined>(
      tx.objectStore(PROJECT_STORE).get(projectId),
    );
    return project ? normalizeProjectIds(project) : undefined;
  }

  async listProjects(limit?: number, offset = 0): Promise<{ projects: Project[]; total: number }> {
    const db = await this.openDb();
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const projects = await requestToPromise<Project[]>(
      tx.objectStore(PROJECT_STORE).getAll(),
    );
    const sorted = projects
      .map(normalizeProjectIds)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return {
      projects: typeof limit === 'number' ? sorted.slice(offset, offset + limit) : sorted.slice(offset),
      total: sorted.length,
    };
  }

  async updateProject(projectId: string, data: Partial<Project>): Promise<Project> {
    const existing = await this.getProject(projectId);
    if (!existing) throw new Error('Project not found');

    let pages = existing.pages || [];
    const order = (data as any).pages_order as string[] | undefined;
    if (order?.length) {
      const byId = new Map(pages.map((page) => [page.id || page.page_id, page]));
      pages = order
        .map((id, index) => {
          const page = byId.get(id);
          return page ? { ...page, order_index: index } : undefined;
        })
        .filter(Boolean) as Page[];
    }

    const { pages_order: _pagesOrder, ...rest } = data as any;
    return this.putProject({
      ...existing,
      ...rest,
      pages,
      project_id: existing.project_id,
      id: existing.id || existing.project_id,
      created_at: existing.created_at,
    });
  }

  async addPage(projectId: string, data: Partial<Page>): Promise<Page> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const now = nowIso();
    const pageId = randomId();
    const page: Page = {
      page_id: pageId,
      id: pageId,
      order_index: data.order_index ?? project.pages.length,
      part: data.part,
      outline_content: data.outline_content ?? null,
      description_content: data.description_content,
      narration_text: data.narration_text,
      generated_image_path: data.generated_image_path,
      generated_image_url: data.generated_image_url,
      status: data.status || 'DRAFT',
      created_at: now,
      updated_at: now,
    };
    await this.putProject({
      ...project,
      pages: [...project.pages, page].sort((a, b) => a.order_index - b.order_index),
    });
    return page;
  }

  async updatePage(projectId: string, pageId: string, data: Partial<Page>): Promise<Page> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    let updatedPage: Page | undefined;
    const pages = project.pages.map((page) => {
      if ((page.id || page.page_id) !== pageId) return page;
      updatedPage = {
        ...page,
        ...data,
        id: page.id || page.page_id,
        page_id: page.page_id || page.id || pageId,
        updated_at: nowIso(),
      };
      return updatedPage;
    });
    if (!updatedPage) throw new Error('Page not found');
    await this.putProject({ ...project, pages });
    return updatedPage;
  }

  async deletePage(projectId: string, pageId: string): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const pages = project.pages
      .filter((page) => (page.id || page.page_id) !== pageId)
      .map((page, index) => ({ ...page, order_index: index }));
    await this.putProject({ ...project, pages });
  }

  async deleteProject(projectId: string): Promise<void> {
    await localFileStore.clearProject(projectId).catch(() => undefined);
    const db = await this.openDb();
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).delete(projectId);
    await txDone(tx);
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(PROJECT_STORE)) {
            const store = db.createObjectStore(PROJECT_STORE, { keyPath: 'project_id' });
            store.createIndex('updated_at', 'updated_at');
            store.createIndex('created_at', 'created_at');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }
}

export const localProjectStore = new BrowserLocalProjectStore();
