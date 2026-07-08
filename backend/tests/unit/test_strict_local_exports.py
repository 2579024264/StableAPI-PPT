import io
import os
import shutil
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from conftest import assert_success_response


def _png_bytes(color="red", size=(320, 180)):
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="PNG")
    buf.seek(0)
    return buf


def _create_project_with_pages(app, project_id="strict-local-project", image_path="uploads/legacy.png"):
    from models import db, Page, Project, Task

    with app.app_context():
        project = Project(
            id=project_id,
            creation_type="idea",
            idea_prompt="strict local export test",
            template_style="default",
            status="DRAFT",
            image_aspect_ratio="16:9",
        )
        page = Page(
            id=f"{project_id}-page-1",
            project_id=project_id,
            order_index=0,
            generated_image_path=image_path,
            narration_text="This is a local narration test.",
            status="IMAGE_GENERATED",
        )
        page.set_outline_content({"title": "Slide 1", "points": ["A"]})
        page.set_description_content({"text": "Description for slide 1"})
        db.session.add(project)
        db.session.add(page)
        db.session.commit()
        return project.id, page.id


def _create_task(app, project_id, task_id, task_type):
    from models import db, Task

    with app.app_context():
        task = Task(id=task_id, project_id=project_id, task_type=task_type, status="PENDING")
        db.session.add(task)
        db.session.commit()
        return task.id


def _write_local_image(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGB", (320, 180), color="green").save(path, format="PNG")


def test_editable_pptx_falls_back_to_full_slide_when_layout_analysis_fails(tmp_path, monkeypatch):
    from services.export_service import ExportService
    import services.image_editability as image_editability

    image_path = tmp_path / "slide.png"
    output_path = tmp_path / "fallback.pptx"
    Image.new("RGB", (320, 180), color="green").save(image_path, format="PNG")

    class FakeServiceConfig:
        @classmethod
        def from_defaults(cls, **_kwargs):
            return cls()

    class FailingImageEditabilityService:
        def __init__(self, _config):
            pass

        def make_image_editable(self, _image_path):
            raise RuntimeError(
                "版面分析失败: MinerU结果目录不存在: /tmp/local_editable_x/editability_work/mineru_files/x"
            )

    monkeypatch.setattr(image_editability, "ServiceConfig", FakeServiceConfig)
    monkeypatch.setattr(image_editability, "ImageEditabilityService", FailingImageEditabilityService)

    _, warnings = ExportService.create_editable_pptx_with_recursive_analysis(
        image_paths=[str(image_path)],
        output_file=str(output_path),
        slide_width_pixels=320,
        slide_height_pixels=180,
        max_depth=1,
        max_workers=1,
        text_attribute_extractor=None,
        fail_fast=True,
        upload_folder=str(tmp_path / "work"),
    )

    assert output_path.exists()
    assert zipfile.is_zipfile(output_path)
    assert warnings.has_warnings()
    assert "版面分析失败" in warnings.other_warnings[0]


def test_local_pptx_pdf_and_images_use_request_files_only(client, app):
    project_id, page_id = _create_project_with_pages(app, project_id="local-standard-export")
    upload_root = app.config["UPLOAD_FOLDER"]

    def fake_pptx(image_paths, output_file=None, **_kwargs):
        assert output_file is None
        assert len(image_paths) == 1
        assert os.path.exists(image_paths[0])
        assert os.path.commonpath([upload_root, image_paths[0]]) != upload_root
        return b"pptx bytes"

    def fake_pdf(image_paths, output_file=None, **_kwargs):
        assert output_file is None
        assert len(image_paths) == 1
        assert os.path.exists(image_paths[0])
        assert os.path.commonpath([upload_root, image_paths[0]]) != upload_root
        return b"pdf bytes"

    with patch("services.export_service.ExportService.create_pptx_from_images", side_effect=fake_pptx):
        response = client.post(
            f"/api/projects/{project_id}/export/local/pptx",
            data={
                "page_ids": page_id,
                "page_ids[0]": page_id,
                "images": (_png_bytes(), "slide.png"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 200
    assert response.data == b"pptx bytes"

    with patch("services.export_service.ExportService.create_pdf_from_images", side_effect=fake_pdf):
        response = client.post(
            f"/api/projects/{project_id}/export/local/pdf",
            data={
                "page_ids": page_id,
                "page_ids[0]": page_id,
                "images": (_png_bytes(), "slide.png"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 200
    assert response.data == b"pdf bytes"

    response = client.post(
        f"/api/projects/{project_id}/export/local/images",
        data={
            "page_ids": f"{page_id},extra-page",
            "page_ids[0]": page_id,
            "page_ids[1]": "extra-page",
            "images": [
                (_png_bytes("blue"), "slide-1.png"),
                (_png_bytes("yellow"), "slide-2.png"),
            ],
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
        assert sorted(zf.namelist()) == ["slide_001.png", "slide_002.png"]

    assert not os.path.exists(os.path.join(upload_root, project_id, "exports"))


def test_local_editable_pptx_endpoint_submits_strict_task_with_temp_images(client, app):
    project_id, page_id = _create_project_with_pages(app, project_id="local-editable-endpoint")
    captured = {}

    def fake_submit_task(task_id, fn, **kwargs):
        captured["task_id"] = task_id
        captured["fn"] = fn
        captured["kwargs"] = kwargs

    with patch("services.task_manager.task_manager.submit_task", side_effect=fake_submit_task):
        response = client.post(
            f"/api/projects/{project_id}/export/local/editable-pptx",
            data={
                "page_ids": page_id,
                "page_ids[0]": page_id,
                "images": (_png_bytes(), "editable.png"),
            },
            content_type="multipart/form-data",
        )

    data = assert_success_response(response)
    assert data["data"]["task_id"] == captured["task_id"]
    assert captured["kwargs"]["strict_local_export_result"] is True
    assert captured["kwargs"]["page_ids"] == [page_id]
    assert captured["kwargs"]["local_image_items"][0]["page_id"] == page_id
    assert os.path.exists(captured["kwargs"]["local_image_items"][0]["path"])
    assert "local_editable_" in captured["kwargs"]["local_temp_dir"]

    shutil.rmtree(captured["kwargs"]["local_temp_dir"], ignore_errors=True)


def test_local_video_endpoint_submits_strict_task_with_full_page_range(client, app):
    project_id, page_id = _create_project_with_pages(app, project_id="local-video-endpoint")
    captured = {}

    def fake_submit_task(task_id, fn, **kwargs):
        captured["task_id"] = task_id
        captured["fn"] = fn
        captured["kwargs"] = kwargs

    with patch("services.task_manager.task_manager.submit_task", side_effect=fake_submit_task):
        response = client.post(
            f"/api/projects/{project_id}/export/local/video",
            data={
                "page_ids": page_id,
                "include_no_image_pages": "true",
                "generate_narration": "false",
            },
            content_type="multipart/form-data",
        )

    data = assert_success_response(response)
    assert data["data"]["task_id"] == captured["task_id"]
    assert captured["kwargs"]["strict_local_export_result"] is True
    assert captured["kwargs"]["include_no_image_pages"] is True
    assert captured["kwargs"]["page_ids"] == [page_id]
    assert captured["kwargs"]["local_image_items"] == []
    assert "local_video_" in captured["kwargs"]["local_temp_dir"]

    shutil.rmtree(captured["kwargs"]["local_temp_dir"], ignore_errors=True)


def test_editable_pptx_strict_task_returns_local_result_and_cleans_temp_dir(app):
    from models import Task
    from services.file_service import FileService
    from services.local_result_store import local_result_store
    from services.task_manager import export_editable_pptx_with_recursive_analysis_task

    project_id, page_id = _create_project_with_pages(app, project_id="local-editable-task")
    task_id = _create_task(app, project_id, "editable-task-id", "EXPORT_EDITABLE_PPTX")
    temp_dir = os.path.join(app.config["UPLOAD_FOLDER"], "strict-editable-temp")
    image_path = os.path.join(temp_dir, "page.png")
    _write_local_image(image_path)

    def fake_create_editable_pptx(image_paths, output_file, upload_folder=None, **_kwargs):
        assert image_paths == [image_path]
        assert output_file.startswith(temp_dir)
        assert upload_folder.startswith(temp_dir)
        with open(output_file, "wb") as f:
            f.write(b"editable pptx bytes")
        return None, SimpleNamespace(has_warnings=lambda: False, to_dict=lambda: {})

    with patch(
        "services.export_service.ExportService.create_editable_pptx_with_recursive_analysis",
        side_effect=fake_create_editable_pptx,
    ):
        export_editable_pptx_with_recursive_analysis_task(
            task_id=task_id,
            project_id=project_id,
            filename="editable.pptx",
            file_service=FileService(app.config["UPLOAD_FOLDER"]),
            page_ids=[page_id],
            local_image_items=[{"page_id": page_id, "path": image_path}],
            strict_local_export_result=True,
            local_temp_dir=temp_dir,
            app=app,
        )

    with app.app_context():
        task = Task.query.get(task_id)
        progress = task.get_progress()
        assert task.status == "COMPLETED"
        assert progress["strict_local_export_result"] is True
        assert progress["download_url"].startswith(f"/api/projects/{project_id}/local-results/")
        result = local_result_store.get(progress["local_result_id"])
        assert result.data == b"editable pptx bytes"
        assert result.filename == "editable.pptx"

    assert not os.path.exists(temp_dir)
    assert not os.path.exists(os.path.join(app.config["UPLOAD_FOLDER"], project_id, "exports", "editable.pptx"))


def test_video_strict_task_returns_local_result_and_cleans_temp_dir(app):
    from models import Task
    from services.file_service import FileService
    from services.local_result_store import local_result_store
    from services.task_manager import export_video_task

    project_id, page_id = _create_project_with_pages(app, project_id="local-video-task")
    task_id = _create_task(app, project_id, "video-task-id", "EXPORT_VIDEO")
    temp_dir = os.path.join(app.config["UPLOAD_FOLDER"], "strict-video-temp")
    image_path = os.path.join(temp_dir, "page.png")
    _write_local_image(image_path)

    def fake_generate_video(pages_data, output_path, **_kwargs):
        assert pages_data[0]["image_path"] == image_path
        assert output_path.startswith(temp_dir)
        with open(output_path, "wb") as f:
            f.write(b"mp4 bytes")

    with patch("services.tts_video_service.check_ffmpeg_available", return_value=True), \
         patch("services.tts_video_service.check_ffmpeg_ass_filter_available", return_value=True), \
         patch("services.tts_video_service.generate_narration_video", side_effect=fake_generate_video):
        export_video_task(
            task_id=task_id,
            project_id=project_id,
            filename="narration.mp4",
            file_service=FileService(app.config["UPLOAD_FOLDER"]),
            generate_narration=False,
            page_ids=[page_id],
            local_image_items=[{"page_id": page_id, "path": image_path}],
            strict_local_export_result=True,
            local_temp_dir=temp_dir,
            app=app,
        )

    with app.app_context():
        task = Task.query.get(task_id)
        progress = task.get_progress()
        assert task.status == "COMPLETED"
        assert progress["strict_local_export_result"] is True
        assert progress["download_url"].startswith(f"/api/projects/{project_id}/local-results/")
        result = local_result_store.get(progress["local_result_id"])
        assert result.data == b"mp4 bytes"
        assert result.content_type == "video/mp4"
        assert result.filename == "narration.mp4"

    assert not os.path.exists(temp_dir)
    assert not os.path.exists(os.path.join(app.config["UPLOAD_FOLDER"], project_id, "exports", "narration.mp4"))
