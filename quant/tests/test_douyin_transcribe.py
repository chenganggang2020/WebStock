import contextlib
import io
import json
import sys
import types
import unittest
from unittest import mock

fake_faster_whisper = types.ModuleType("faster_whisper")
fake_faster_whisper.WhisperModel = object
with mock.patch.dict(sys.modules, {"faster_whisper": fake_faster_whisper}):
    import douyin_transcribe


class DouyinTranscribeResourceLimitsTests(unittest.TestCase):
    def test_model_construction_failure_preserves_the_original_error(self):
        class FailingWhisperModel:
            def __init__(self, _model_name, **_kwargs):
                raise RuntimeError("model allocation failed")

        argv = [
            "douyin_transcribe.py",
            "--media", "archived.mp4",
            "--model-root", "models",
        ]
        with mock.patch.object(douyin_transcribe, "WhisperModel", FailingWhisperModel), \
                mock.patch.object(sys, "argv", argv):
            with self.assertRaisesRegex(RuntimeError, "model allocation failed"):
                douyin_transcribe.main()

    def test_main_limits_whisper_workers_and_releases_the_loaded_model(self):
        calls = {}

        class FakeBackend:
            def unload_model(self):
                calls["unloaded"] = True

        class FakeInfo:
            language = "zh"
            language_probability = 0.99
            duration = 3.2

        class FakeSegment:
            start = 0.1
            end = 1.2
            text = "测试转写"

        class FakeWhisperModel:
            def __init__(self, model_name, **kwargs):
                calls["model_name"] = model_name
                calls["model_kwargs"] = kwargs
                self.model = FakeBackend()

            def transcribe(self, media_path, **kwargs):
                calls["media_path"] = media_path
                calls["transcribe_kwargs"] = kwargs
                return iter([FakeSegment()]), FakeInfo()

        stdout = io.StringIO()
        argv = [
            "douyin_transcribe.py",
            "--media", "archived.mp4",
            "--model-root", "models",
            "--model", "small",
        ]
        with mock.patch.object(douyin_transcribe, "WhisperModel", FakeWhisperModel), \
                mock.patch.object(sys, "argv", argv), \
                contextlib.redirect_stdout(stdout):
            douyin_transcribe.main()

        result = json.loads(stdout.getvalue())
        self.assertEqual(calls["model_name"], "small")
        self.assertEqual(calls["model_kwargs"]["device"], "cpu")
        self.assertEqual(calls["model_kwargs"]["compute_type"], "int8")
        self.assertEqual(calls["model_kwargs"]["cpu_threads"], 2)
        self.assertEqual(calls["model_kwargs"]["num_workers"], 1)
        self.assertEqual(calls["transcribe_kwargs"]["beam_size"], 5)
        self.assertTrue(calls.get("unloaded"))
        self.assertEqual(result["transcript"], "测试转写")


if __name__ == "__main__":
    unittest.main()
