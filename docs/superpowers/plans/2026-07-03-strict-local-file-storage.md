# Strict Local File Storage Plan

## Goal

Run Banana Slides as a web service where user file bytes are not retained on the server. Uploaded files, templates, materials, generated page images, export outputs, and image versions live in the user's browser storage. The backend may receive files only for a single request or task, and must delete temporary files after producing a response.

## Storage Model

- Browser owns durable file bytes through IndexedDB/OPFS.
- Backend owns project metadata, text state, task state, and AI orchestration.
- Stable local file references use `local-file://{id}`.
- UI rendering converts local file references into in-memory `blob:` object URLs for the current session.
- Server-side `/files/...` URLs remain supported for the legacy/default mode.

## Implemented Foundation

- `frontend/src/services/localFileStore.ts`
  - Stores metadata in IndexedDB.
  - Uses OPFS for file bytes when available.
  - Falls back to IndexedDB Blob storage when OPFS is unavailable.
- `frontend/src/services/localFileUrls.ts`
  - Registers stable `local-file://` references to session `blob:` URLs.
- `frontend/src/services/strictLocalFiles.ts`
  - Feature-flagged local wrappers for materials and user templates.
- `VITE_STRICT_LOCAL_FILES=true`
  - Switches the first local wrappers on without changing default deployments.

## Migration Phases

### Phase 1: Local Libraries

- Materials: upload, list, delete, select from local storage.
- User templates: upload, list, delete, select from local storage.
- Text-only style templates stay unchanged because they do not contain file bytes.

### Phase 2: Generated Images

- Add backend endpoints that return generated image bytes directly instead of saving under `uploads`.
- Change image task completion payloads to include transient image download IDs or direct Blob responses.
- Frontend task polling stores returned images as `page-image` records.
- Page records should store `local-file://` IDs rather than `/files/{project}/pages/...`.
- Image versions should move to local records keyed by `pageId` and version number.

Current implementation status:

- Strict-mode image generation now stores generated image bytes in a temporary `local-result://{id}` handoff store instead of `uploads`.
- The frontend claims `local-result://` images during project sync, stores them in IndexedDB/OPFS, then confirms the page image as `local-file://{id}`.
- The temporary handoff store is process-local and TTL-based. A production deployment with multiple backend workers needs sticky routing or an external ephemeral result backend.

### Phase 3: Reference Files

- Replace persistent upload with parse-only upload:
  - Frontend sends the selected file for parsing.
  - Backend writes to a temp directory.
  - Backend returns parsed markdown and extracted image bytes.
  - Backend deletes all temp files.
- Store parsed markdown in the project DB.
- Store extracted images locally as `material` records.
- Re-parse requires the user to reselect the original local file.

### Phase 4: Export

- Add multipart export endpoints that accept selected local page images.
- Return PPTX/PDF/ZIP/video as a Blob response.
- Frontend saves export results as `export` records and triggers a browser download.
- Server export history is disabled in strict local mode; local export history is optional.

Current implementation status:

- Strict-mode standard PPTX/PDF/images export now uploads browser-local page images as multipart request files.
- The backend writes those files only into a request-scoped temporary directory and returns the generated PPTX/PDF/image/ZIP as a Blob response.
- Strict-mode editable PPTX and video export now use multipart local page-image submission plus async task result handoff.
- Async strict-mode export tasks write inputs, intermediate files, and output artifacts under task temporary directories, then put the final PPTX/MP4 bytes in the temporary local-result store.
- The frontend claims strict-mode async export results, stores them as local `export` records in IndexedDB/OPFS, and exposes a session object URL for download.
- The default `/exports` history and `/files/{project}/exports/...` download URL flow remains for legacy mode.

### Phase 5: Image Edit And Renovation

- Frontend sends the current page image, selected template/material images, and any context images as multipart temp inputs.
- Backend returns edited image bytes.
- Frontend stores the edited image locally as a new page image version.
- PPT/PDF renovation becomes parse-only and cannot be regenerated without reselecting the original file.

## Backend Rules

- Use `TemporaryDirectory` for all file bytes received in strict mode.
- Never create `/files/...` URLs for strict-mode task results.
- Never persist generated images, materials, templates, exports, or reference uploads to `UPLOAD_FOLDER`.
- Keep existing `/files/...` behavior for legacy mode until the migration is complete.

## Compatibility Risks

- Browser storage quotas vary by browser and user settings.
- `local-file://` references are device-local and do not sync across browsers.
- Long-running background tasks need a task-result handoff because the browser must store the returned file bytes before they expire.
- Markdown content that embeds local images needs a resolver that refreshes object URLs after page reload.
- OPFS is not universally available, so IndexedDB Blob fallback is required.
