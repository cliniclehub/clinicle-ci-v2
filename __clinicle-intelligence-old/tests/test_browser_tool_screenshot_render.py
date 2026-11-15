# encoding:utf-8
"""agent/tools/browser/browser_tool.py's screenshot action: the result must
be shaped like agent/tools/send/send.py's own file_to_send result, since
agent_stream.py's _execute_tool special-cases that exact shape (a dict with
type == "file_to_send") to emit a "file_to_send" event -- the same event the
web/desktop clients already render as an inline <img>. Before this, a
screenshot came back as the plain string "Screenshot saved to: {path}",
which never rendered anywhere -- the actual gap being closed."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

if "requests" not in sys.modules:
    _requests_stub = types.ModuleType("requests")
    _requests_stub.get = lambda *a, **k: None
    sys.modules["requests"] = _requests_stub


class _StubService:
    def __init__(self, filepath):
        self._filepath = filepath

    def screenshot(self, full_page=False, cwd=""):
        return self._filepath


class TestBrowserScreenshotRendersAsFileToSend(unittest.TestCase):
    def setUp(self):
        from agent.tools.browser.browser_tool import BrowserTool
        self.tool = BrowserTool()

    def _run(self, filepath, full_page=False):
        from unittest.mock import patch
        from agent.tools.browser.browser_tool import BrowserTool

        stub = _StubService(filepath)
        with patch.object(BrowserTool, "_get_service", return_value=stub), \
             patch.object(BrowserTool, "_check_engine_ready", return_value=None), \
             patch.object(BrowserTool, "_check_memory_budget", return_value=None):
            args = {"action": "screenshot"}
            if full_page:
                args["full_page"] = True
            return self.tool.execute(args)

    def test_screenshot_result_is_a_file_to_send_dict(self):
        result = self._run("/tmp/cow_screens/screenshot_abc123.png")
        self.assertEqual(result.status, "success")
        self.assertIsInstance(result.result, dict)
        self.assertEqual(result.result["type"], "file_to_send")
        self.assertEqual(result.result["file_type"], "image")
        self.assertEqual(result.result["path"], "/tmp/cow_screens/screenshot_abc123.png")
        self.assertEqual(result.result["file_name"], "screenshot_abc123.png")
        self.assertEqual(result.result["mime_type"], "image/png")

    def test_screenshot_message_still_names_the_saved_path(self):
        """The old plain-text confirmation ("Screenshot saved to: {path}") is
        preserved as the human-facing message field, not lost in the switch
        to a structured result."""
        result = self._run("/tmp/cow_screens/screenshot_xyz.png")
        self.assertIn("/tmp/cow_screens/screenshot_xyz.png", result.result["message"])


if __name__ == "__main__":
    unittest.main()
