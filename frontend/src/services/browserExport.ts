import { zipSync } from 'fflate';
import type { ApiResponse } from '@/types';

export interface BrowserExportImageInput {
  pageId: string;
  file: File;
}

export interface BrowserPptxExportOptions {
  filename?: string;
  aspectRatio?: string;
  transitionEnabled?: boolean;
  transitionEffects?: string[];
}

const textEncoder = new TextEncoder();

const encodeText = (value: string): Uint8Array => textEncoder.encode(value);

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

const parseAspectRatio = (aspectRatio?: string): { width: number; height: number } => {
  const [rawWidth, rawHeight] = (aspectRatio || '16:9').split(':');
  const width = Number.parseFloat(rawWidth);
  const height = Number.parseFloat(rawHeight);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 16, height: 9 };
};

const getExtension = (file: File): 'png' | 'jpg' | 'jpeg' => {
  const nameExt = file.name.split('.').pop()?.toLowerCase();
  if (nameExt === 'jpg' || nameExt === 'jpeg' || nameExt === 'png') return nameExt;
  if (file.type === 'image/jpeg') return 'jpg';
  return 'png';
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), {
    href,
    download: filename,
  });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
};

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const createImageElement = async (file: File): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

const drawImageToCanvas = async (
  file: File,
  aspectRatio?: string,
  targetWidth = 1920,
): Promise<HTMLCanvasElement> => {
  const image = await createImageElement(file);
  const ratio = parseAspectRatio(aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = Math.round((targetWidth * ratio.height) / ratio.width);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (canvas.width - drawWidth) / 2;
  const y = (canvas.height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
  URL.revokeObjectURL(image.src);
  return canvas;
};

const canvasToJpegBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Failed to encode image'));
    }, 'image/jpeg', 0.92);
  });
  return new Uint8Array(await blob.arrayBuffer());
};

const contentTypesXml = (slideCount: number, imageExtensions: string[]): string => {
  const hasPng = imageExtensions.includes('png');
  const hasJpeg = imageExtensions.some(ext => ext === 'jpg' || ext === 'jpeg');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${hasPng ? '<Default Extension="png" ContentType="image/png"/>' : ''}
  ${hasJpeg ? '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n  ')}
</Types>`;
};

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const appXml = (slideCount: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Banana Slides</Application>
  <PresentationFormat>On-screen Show</PresentationFormat>
  <Slides>${slideCount}</Slides>
</Properties>`;

const coreXml = (): string => {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Presentation</dc:title>
  <dc:creator>Banana Slides</dc:creator>
  <cp:lastModifiedBy>Banana Slides</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
};

const presentationXml = (slideCount: number, cx: number, cy: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${slideCount + 1}"/></p:sldMasterIdLst>
  <p:sldIdLst>
    ${Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('\n    ')}
  </p:sldIdLst>
  <p:sldSz cx="${cx}" cy="${cy}" type="custom"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

const presentationRelsXml = (slideCount: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('\n  ')}
  <Relationship Id="rId${slideCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

const transitionXml = (effect?: string): string => {
  switch (effect) {
    case 'push':
      return '<p:transition><p:push dir="l"/></p:transition>';
    case 'wipe':
      return '<p:transition><p:wipe dir="l"/></p:transition>';
    case 'split':
      return '<p:transition><p:split orient="horz" dir="out"/></p:transition>';
    case 'blinds':
      return '<p:transition><p:blinds dir="horz"/></p:transition>';
    case 'checker':
      return '<p:transition><p:checker dir="horz"/></p:transition>';
    case 'wheel':
      return '<p:transition><p:wheel spokes="1"/></p:transition>';
    case 'page_turn':
    case 'fade':
    default:
      return '<p:transition><p:fade/></p:transition>';
  }
};

const slideXml = (
  slideNumber: number,
  cx: number,
  cy: number,
  transitionEffect?: string,
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="${escapeXml(`Slide ${slideNumber}`)}"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId1"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="${cx}" cy="${cy}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  ${transitionEffect ? transitionXml(transitionEffect) : ''}
</p:sld>`;

const slideRelsXml = (imageName: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${escapeXml(imageName)}"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const slideLayoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`;

const slideLayoutRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const slideMasterRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Banana Slides">
  <a:themeElements>
    <a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="F6C453"/></a:accent1><a:accent2><a:srgbClr val="6B7CFF"/></a:accent2><a:accent3><a:srgbClr val="36B37E"/></a:accent3><a:accent4><a:srgbClr val="FF7452"/></a:accent4><a:accent5><a:srgbClr val="6554C0"/></a:accent5><a:accent6><a:srgbClr val="00B8D9"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`;

export const exportBrowserPPTX = async (
  projectId: string,
  images: BrowserExportImageInput[],
  options: BrowserPptxExportOptions = {},
): Promise<ApiResponse<{ download_url: string }>> => {
  if (images.length === 0) throw new Error('没有可导出的图片');

  const ratio = parseAspectRatio(options.aspectRatio);
  const slideCx = 12192000;
  const slideCy = Math.round((slideCx * ratio.height) / ratio.width);
  const zipEntries: Record<string, Uint8Array> = {};
  const imageExtensions: string[] = [];

  zipEntries['[Content_Types].xml'] = encodeText(contentTypesXml(images.length, imageExtensions));
  zipEntries['_rels/.rels'] = encodeText(rootRelsXml);
  zipEntries['docProps/app.xml'] = encodeText(appXml(images.length));
  zipEntries['docProps/core.xml'] = encodeText(coreXml());
  zipEntries['ppt/presentation.xml'] = encodeText(presentationXml(images.length, slideCx, slideCy));
  zipEntries['ppt/_rels/presentation.xml.rels'] = encodeText(presentationRelsXml(images.length));
  zipEntries['ppt/slideLayouts/slideLayout1.xml'] = encodeText(slideLayoutXml);
  zipEntries['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = encodeText(slideLayoutRelsXml);
  zipEntries['ppt/slideMasters/slideMaster1.xml'] = encodeText(slideMasterXml);
  zipEntries['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = encodeText(slideMasterRelsXml);
  zipEntries['ppt/theme/theme1.xml'] = encodeText(themeXml);

  for (const [index, image] of images.entries()) {
    const slideNumber = index + 1;
    const extension = getExtension(image.file);
    imageExtensions.push(extension);
    const imageName = `image${slideNumber}.${extension === 'jpeg' ? 'jpg' : extension}`;
    const effect = options.transitionEnabled
      ? options.transitionEffects?.[index % Math.max(options.transitionEffects.length, 1)] || 'fade'
      : undefined;
    zipEntries[`ppt/slides/slide${slideNumber}.xml`] = encodeText(slideXml(slideNumber, slideCx, slideCy, effect));
    zipEntries[`ppt/slides/_rels/slide${slideNumber}.xml.rels`] = encodeText(slideRelsXml(imageName));
    zipEntries[`ppt/media/${imageName}`] = new Uint8Array(await image.file.arrayBuffer());
  }

  zipEntries['[Content_Types].xml'] = encodeText(contentTypesXml(images.length, imageExtensions));
  const blob = new Blob([toArrayBuffer(zipSync(zipEntries))], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  downloadBlob(blob, options.filename || `presentation_${projectId}.pptx`);
  return { success: true, data: { download_url: '' } };
};

const buildPdf = async (
  images: BrowserExportImageInput[],
  aspectRatio?: string,
): Promise<Uint8Array> => {
  const ratio = parseAspectRatio(aspectRatio);
  const pageWidth = 960;
  const pageHeight = Math.round((pageWidth * ratio.height) / ratio.width);
  const jpegImages = await Promise.all(
    images.map(async image => canvasToJpegBytes(await drawImageToCanvas(image.file, aspectRatio))),
  );

  const pageObjStart = 3;
  const contentObjStart = pageObjStart + images.length;
  const imageObjStart = contentObjStart + images.length;
  const totalObjects = 2 + images.length * 3;
  const kids = images.map((_, index) => `${pageObjStart + index} 0 R`).join(' ');
  const objects: Uint8Array[] = [];

  objects[1] = encodeText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects[2] = encodeText(`2 0 obj\n<< /Type /Pages /Count ${images.length} /Kids [ ${kids} ] >>\nendobj\n`);

  for (let index = 0; index < images.length; index += 1) {
    const pageObj = pageObjStart + index;
    const contentObj = contentObjStart + index;
    const imageObj = imageObjStart + index;
    objects[pageObj] = encodeText(`${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im1 ${imageObj} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentObj} 0 R >>\nendobj\n`);
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im1 Do\nQ\n`;
    objects[contentObj] = encodeText(`${contentObj} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    const jpeg = jpegImages[index];
    objects[imageObj] = concatBytes([
      encodeText(`${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1920 /Height ${Math.round((1920 * ratio.height) / ratio.width)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      encodeText('\nendstream\nendobj\n'),
    ]);
  }

  const parts: Uint8Array[] = [encodeText('%PDF-1.4\n')];
  const offsets = new Array(totalObjects + 1).fill(0);
  let byteOffset = parts[0].length;
  for (let objectNumber = 1; objectNumber <= totalObjects; objectNumber += 1) {
    offsets[objectNumber] = byteOffset;
    const object = objects[objectNumber];
    parts.push(object);
    byteOffset += object.length;
  }

  const xrefOffset = byteOffset;
  const xref = [
    'xref',
    `0 ${totalObjects + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${totalObjects + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(encodeText(xref));
  return concatBytes(parts);
};

export const exportBrowserPDF = async (
  projectId: string,
  images: BrowserExportImageInput[],
  filename?: string,
  aspectRatio?: string,
): Promise<ApiResponse<{ download_url: string }>> => {
  if (images.length === 0) throw new Error('没有可导出的图片');
  const pdfBytes = await buildPdf(images, aspectRatio);
  const blob = new Blob([toArrayBuffer(pdfBytes)], { type: 'application/pdf' });
  downloadBlob(blob, filename || `presentation_${projectId}.pdf`);
  return { success: true, data: { download_url: '' } };
};

export const exportBrowserImages = async (
  projectId: string,
  images: BrowserExportImageInput[],
): Promise<ApiResponse<{ download_url: string }>> => {
  if (images.length === 0) throw new Error('没有可导出的图片');
  if (images.length === 1) {
    const image = images[0];
    const extension = getExtension(image.file);
    downloadBlob(image.file, image.file.name || `slide_${image.pageId}.${extension}`);
    return { success: true, data: { download_url: '' } };
  }

  const entries: Record<string, Uint8Array> = {};
  for (const [index, image] of images.entries()) {
    const extension = getExtension(image.file);
    entries[`slide_${pad(index + 1)}.${extension === 'jpeg' ? 'jpg' : extension}`] =
      new Uint8Array(await image.file.arrayBuffer());
  }

  const blob = new Blob([toArrayBuffer(zipSync(entries))], { type: 'application/zip' });
  downloadBlob(blob, `slides_${projectId}.zip`);
  return { success: true, data: { download_url: '' } };
};

export const createStrictLocalExportUnavailableError = (feature: string): Error =>
  new Error(`${feature} 需要服务端处理文件数据；严格本地模式下已禁用，避免上传用户图片或文件。`);
