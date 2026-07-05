const LOCAL_FILE_URL_PREFIX = 'local-file://';

const objectUrlByLocalUrl = new Map<string, string>();

export const toLocalFileUrl = (id: string): string => `${LOCAL_FILE_URL_PREFIX}${id}`;

export const isLocalFileUrl = (url?: string | null): boolean =>
  typeof url === 'string' && url.startsWith(LOCAL_FILE_URL_PREFIX);

export const getLocalFileIdFromUrl = (url: string): string =>
  url.slice(LOCAL_FILE_URL_PREFIX.length);

export const registerLocalFileObjectUrl = (localUrl: string, objectUrl: string): void => {
  const previous = objectUrlByLocalUrl.get(localUrl);
  if (previous && previous !== objectUrl) {
    URL.revokeObjectURL(previous);
  }
  objectUrlByLocalUrl.set(localUrl, objectUrl);
};

export const resolveLocalFileObjectUrl = (localUrl: string): string | undefined =>
  objectUrlByLocalUrl.get(localUrl);

export const revokeLocalFileObjectUrl = (localUrl: string): void => {
  const objectUrl = objectUrlByLocalUrl.get(localUrl);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrlByLocalUrl.delete(localUrl);
  }
};
