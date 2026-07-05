import type { Material } from '@/types';
import type { Page, Project } from '@/types';
import type { UserTemplate } from '@/api/endpoints';
import type { LocalExportImageInput } from '@/api/endpoints';
import { localFileStore, type LocalFileRecord } from './localFileStore';
import { getLocalFileIdFromUrl, isLocalFileUrl, toLocalFileUrl } from './localFileUrls';

export const strictLocalFilesEnabled =
  import.meta.env.VITE_STRICT_LOCAL_FILES === 'true';

const recordToMaterial = async (record: LocalFileRecord): Promise<Material> => {
  await localFileStore.createObjectUrl(record.id);
  const localUrl = toLocalFileUrl(record.id);
  return {
    id: record.id,
    project_id: record.projectId ?? null,
    filename: record.name,
    url: localUrl,
    relative_path: localUrl,
    caption: record.caption ?? null,
    original_filename: record.name,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
};

const recordToUserTemplate = async (record: LocalFileRecord): Promise<UserTemplate> => {
  await localFileStore.createObjectUrl(record.id);
  return {
    template_id: record.id,
    name: record.name,
    template_image_url: toLocalFileUrl(record.id),
    thumb_url: toLocalFileUrl(record.id),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
};

export const uploadLocalMaterial = async (
  file: File,
  projectId?: string | null,
  caption?: string | null,
): Promise<Material> => {
  const record = await localFileStore.putFile(file, {
    kind: 'material',
    projectId: projectId && projectId !== 'none' ? projectId : null,
    caption,
  });
  return recordToMaterial(record);
};

export const listLocalMaterials = async (
  projectId?: string,
): Promise<{ materials: Material[]; count: number }> => {
  const records = await localFileStore.listFiles({
    kind: 'material',
    projectId: !projectId || projectId === 'all'
      ? 'all'
      : projectId === 'none'
        ? null
        : projectId,
  });
  const materials = await Promise.all(records.map(recordToMaterial));
  return { materials, count: materials.length };
};

export const deleteLocalMaterial = async (materialId: string): Promise<void> => {
  await localFileStore.deleteFile(materialId);
};

export const getLocalMaterialByUrl = async (url: string): Promise<Material | undefined> => {
  if (!url.startsWith('local-file://')) return undefined;
  const record = await localFileStore.getRecord(url.slice('local-file://'.length));
  return record && record.kind === 'material' ? recordToMaterial(record) : undefined;
};

export const uploadLocalUserTemplate = async (
  templateImage: File,
  name?: string,
): Promise<UserTemplate> => {
  const record = await localFileStore.putFile(templateImage, {
    kind: 'template',
    metadata: { displayName: name },
  });
  return recordToUserTemplate(record);
};

export const uploadLocalProjectTemplate = async (
  templateImage: File,
  projectId: string,
): Promise<string> => {
  const record = await localFileStore.putFile(templateImage, {
    kind: 'template',
    projectId,
    metadata: { scope: 'project-template' },
  });
  await localFileStore.createObjectUrl(record.id);
  return toLocalFileUrl(record.id);
};

export const listLocalUserTemplates = async (): Promise<UserTemplate[]> => {
  const records = await localFileStore.listFiles({ kind: 'template', projectId: 'all' });
  return Promise.all(records.map(recordToUserTemplate));
};

export const deleteLocalUserTemplate = async (templateId: string): Promise<void> => {
  await localFileStore.deleteFile(templateId);
};

export const getLocalFile = (id: string): Promise<File | undefined> =>
  localFileStore.getFile(id);

export const isLocalResultUrl = (url?: string | null): boolean =>
  typeof url === 'string' && url.startsWith('local-result://');

export const getLocalResultIdFromUrl = (url: string): string =>
  url.slice('local-result://'.length);

export const storeLocalPageImageBlob = async (
  blob: Blob,
  projectId: string,
  pageId: string,
  filename?: string,
): Promise<string> => {
  const record = await localFileStore.putBlob(
    blob,
    filename || `${pageId}.png`,
    blob.type || 'image/png',
    {
      kind: 'page-image',
      projectId,
      pageId,
    },
  );
  await localFileStore.createObjectUrl(record.id);
  return toLocalFileUrl(record.id);
};

export const storeLocalExportBlob = async (
  blob: Blob,
  projectId: string,
  filename: string,
): Promise<{ localFileUrl: string; objectUrl?: string }> => {
  const record = await localFileStore.putBlob(
    blob,
    filename,
    blob.type || 'application/octet-stream',
    {
      kind: 'export',
      projectId,
    },
  );
  const objectUrl = await localFileStore.createObjectUrl(record.id);
  return {
    localFileUrl: toLocalFileUrl(record.id),
    objectUrl,
  };
};

export const collectLocalPageImagesForExport = async (
  project: Project,
  pageIds?: string[],
): Promise<LocalExportImageInput[]> => {
  const selected = new Set(pageIds || []);
  const pages = (project.pages || [])
    .filter((page: Page) => !pageIds || selected.has(page.id || page.page_id))
    .sort((a, b) => a.order_index - b.order_index);

  const images: LocalExportImageInput[] = [];
  for (const page of pages) {
    const pageId = page.id || page.page_id;
    const imageUrl = page.generated_image_path || page.generated_image_url;
    if (!pageId || !isLocalFileUrl(imageUrl)) continue;

    const file = await localFileStore.getFile(getLocalFileIdFromUrl(imageUrl as string));
    if (file) {
      images.push({
        pageId,
        file: new File([file], file.name || `${pageId}.png`, { type: file.type || 'image/png' }),
      });
    }
  }
  return images;
};
