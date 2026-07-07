import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useImagePaste } from '@/hooks/useImagePaste';
import { uploadMaterial } from '@/api/endpoints';
import { uploadLocalMaterial } from '@/services/strictLocalFiles';

vi.mock('@/api/endpoints', () => ({
  uploadMaterial: vi.fn(),
  getMaterialByUrl: vi.fn(),
}));

vi.mock('@/services/strictLocalFiles', () => ({
  uploadLocalMaterial: vi.fn(),
}));

const mockedUploadMaterial = vi.mocked(uploadMaterial);
const mockedUploadLocalMaterial = vi.mocked(uploadLocalMaterial);

const makeImageFile = () => new File(['image-bytes'], 'test_img.png', { type: 'image/png' });

const Harness = ({ file }: { file: File }) => {
  const [content, setContent] = useState('');
  const { handleFiles } = useImagePaste({
    projectId: null,
    setContent,
    showToast: vi.fn(),
    localOnly: true,
  });

  return (
    <>
      <button type="button" onClick={() => handleFiles([file])}>
        insert image
      </button>
      <output aria-label="content">{content}</output>
    </>
  );
};

describe('useImagePaste localOnly', () => {
  beforeEach(() => {
    mockedUploadMaterial.mockReset();
    mockedUploadLocalMaterial.mockReset();
    mockedUploadLocalMaterial.mockImplementation(async (file, projectId, caption) => ({
      id: 'local-material-1',
      project_id: projectId ?? null,
      filename: file.name,
      url: 'local-file://local-material-1',
      relative_path: 'local-file://local-material-1',
      caption: caption ?? null,
      original_filename: file.name,
      created_at: '2026-07-08T00:00:00.000Z',
      updated_at: '2026-07-08T00:00:00.000Z',
    }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:test-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('stores images locally instead of uploading them to the backend', async () => {
    render(<Harness file={makeImageFile()} />);

    fireEvent.click(screen.getByRole('button', { name: 'insert image' }));

    await waitFor(() => {
      expect(screen.getByLabelText('content')).toHaveTextContent(
        '![test_img](local-file://local-material-1)',
      );
    });
    expect(mockedUploadLocalMaterial).toHaveBeenCalledTimes(1);
    expect(mockedUploadMaterial).not.toHaveBeenCalled();
  });
});
