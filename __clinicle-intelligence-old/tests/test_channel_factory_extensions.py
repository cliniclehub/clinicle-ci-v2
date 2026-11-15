# encoding:utf-8
"""channel/channel_factory.py's extension channel registry: an
admin-installed extension's channel_code becomes a real, creatable Channel
subclass through create_channel() -- same on-disk directory-scan pattern
as ToolManager's extension tools and the assistant handler registry."""

from unittest.mock import patch

from channel import channel_factory
from channel.channel import Channel


def teardown_function():
    channel_factory._EXTENSION_CHANNELS.clear()


class _DemoChannel(Channel):
    def startup(self):
        pass

    def handle_text(self, msg):
        pass

    def send(self, reply, context):
        pass


def test_register_and_create_an_extension_channel():
    channel_factory.register_extension_channel("demo-channel", _DemoChannel)

    ch = channel_factory.create_channel("demo-channel")

    assert isinstance(ch, _DemoChannel)
    assert ch.channel_type == "demo-channel"


def test_unregister_extension_channel_makes_it_unsupported_again():
    channel_factory.register_extension_channel("demo-channel", _DemoChannel)
    channel_factory.unregister_extension_channel("demo-channel")

    try:
        channel_factory.create_channel("demo-channel")
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "unsupported channel_type" in str(e)


def test_unregister_an_unknown_channel_type_is_a_noop():
    channel_factory.unregister_extension_channel("never-registered")


def test_reload_extension_channels_registers_a_channel_subclass_from_disk(tmp_path):
    ext_dir = tmp_path / "extension_channels"
    ext_dir.mkdir()
    (ext_dir / "demo-channel.py").write_text(
        "from channel.channel import Channel\n"
        "class DemoExtChannel(Channel):\n"
        "    def startup(self):\n"
        "        pass\n"
        "    def handle_text(self, msg):\n"
        "        pass\n"
        "    def send(self, reply, context):\n"
        "        pass\n",
        encoding="utf-8",
    )
    with patch("config.get_data_root", return_value=str(tmp_path)):
        channel_factory.reload_extension_channels()

    ch = channel_factory.create_channel("demo-channel")
    assert ch.__class__.__name__ == "DemoExtChannel"


def test_reload_extension_channels_is_a_noop_when_the_directory_is_missing(tmp_path):
    with patch("config.get_data_root", return_value=str(tmp_path)):
        channel_factory.reload_extension_channels()  # must not raise


def test_a_file_without_a_channel_subclass_is_not_registered(tmp_path):
    ext_dir = tmp_path / "extension_channels"
    ext_dir.mkdir()
    (ext_dir / "broken.py").write_text("x = 1\n", encoding="utf-8")
    with patch("config.get_data_root", return_value=str(tmp_path)):
        channel_factory.reload_extension_channels()
    assert "broken" not in channel_factory._EXTENSION_CHANNELS
