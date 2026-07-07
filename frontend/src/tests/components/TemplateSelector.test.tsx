import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { TemplateSelector, getTemplateFile } from '@/components/shared/TemplateSelector';
import { listUserTemplates, uploadUserTemplate } from '@/api/endpoints';

vi.mock('@/hooks/useT', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('@/api/endpoints', async () => {
  const actual = await vi.importActual<any>('@/api/endpoints');
  return {
    ...actual,
    listUserTemplates: vi.fn(),
    uploadUserTemplate: vi.fn(),
    deleteUserTemplate: vi.fn(),
  };
});

describe('getTemplateFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a File when the preset template response is an image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['image-bytes'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const file = await getTemplateFile('1', []);

    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe('template_y.png');
    expect(file?.type).toBe('image/png');
  });

  it('rejects a preset template response that is html', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>not found</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const file = await getTemplateFile('1', []);

    expect(file).toBeNull();
  });

  it('rejects a failed user template response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('missing', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const file = await getTemplateFile('template-001', [
      {
        template_id: 'template-001',
        template_image_url: '/files/user-templates/template-001/template.png',
        created_at: '2026-05-29T00:00:00Z',
      },
    ]);

    expect(file).toBeNull();
  });
});

describe('TemplateSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listUserTemplates).mockResolvedValue({
      success: true,
      data: { templates: [] },
    } as any);
  });

  it('notifies the parent when a newly uploaded user template is saved', async () => {
    const template = {
      template_id: 'template-001',
      template_image_url: '/files/user-templates/template-001/template.png',
      thumb_url: '/files/user-templates/template-001/template-thumb.webp',
      created_at: '2026-07-07T00:00:00Z',
      updated_at: '2026-07-07T00:00:00Z',
    };
    vi.mocked(uploadUserTemplate).mockResolvedValue({
      success: true,
      data: template,
    } as any);

    const onSelect = vi.fn();
    const onTemplateSaved = vi.fn();
    const { container } = render(
      <TemplateSelector
        onSelect={onSelect}
        onTemplateSaved={onTemplateSaved}
        showUpload={true}
      />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['image-bytes'], 'template.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onTemplateSaved).toHaveBeenCalledWith(template);
    });
    expect(onSelect).toHaveBeenCalledWith(null, 'template-001');
  });
});
