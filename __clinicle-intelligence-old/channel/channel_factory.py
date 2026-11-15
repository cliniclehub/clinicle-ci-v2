"""
channel factory
"""
from pathlib import Path
from typing import Dict, Type

from common import const
from .channel import Channel

# Admin-installed extension channels (channel/web/api/extensions.py's
# channel_code field) -- a real Channel subclass loaded from an on-disk
# .py file under get_data_root()/extension_channels/<channel_type>.py,
# same exec-a-file-from-disk pattern agent/tools/tool_manager.py's
# ToolManager.reload_extension_tools uses, not a separate mechanism.
_EXTENSION_CHANNELS: Dict[str, Type[Channel]] = {}


def register_extension_channel(channel_type: str, cls: Type[Channel]) -> None:
    _EXTENSION_CHANNELS[channel_type] = cls


def unregister_extension_channel(channel_type: str) -> None:
    _EXTENSION_CHANNELS.pop(channel_type, None)


def reload_extension_channels() -> None:
    """Scans get_data_root()/extension_channels/*.py, registering each
    file's Channel subclass under its filename (== the extension's id,
    channel/web/api/extensions.py writes exactly one file per extension).
    Safe to call again after install/toggle -- it only adds/overwrites
    entries for files still present; channel/web/api/extensions.py calls
    unregister_extension_channel directly for a disabled/removed one."""
    from config import get_data_root

    ext_dir = Path(get_data_root()) / "extension_channels"
    if not ext_dir.is_dir():
        return
    for py_file in ext_dir.glob("*.py"):
        _load_extension_channel_file(py_file)


def _load_extension_channel_file(py_file) -> bool:
    """Loads one .py file's Channel subclass and registers it under the
    file's stem. Returns True if a Channel subclass was found."""
    import importlib.util

    from common.log import logger

    py_file = Path(py_file)
    channel_type = py_file.stem
    try:
        spec = importlib.util.spec_from_file_location(channel_type, py_file)
        if not (spec and spec.loader):
            return False
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for attr_name in dir(module):
            cls = getattr(module, attr_name)
            if isinstance(cls, type) and issubclass(cls, Channel) and cls is not Channel:
                register_extension_channel(channel_type, cls)
                return True
    except Exception as e:
        logger.error(f"[ChannelFactory] Failed to load extension channel {channel_type!r}: {e}")
    return False


def create_channel(channel_type, instance_id="", bound_agent_id="", credentials=None, members=None, peers=None) -> Channel:
    """
    create a channel instance

    :param channel_type: channel type code
    :param instance_id: unique id when running several instances of the same
        channel type. Empty -> legacy single-instance behavior (the channel's
        own @singleton cache is used, exactly as before).
    :param bound_agent_id: Agent this instance routes inbound messages to.
    :param credentials: per-instance credential overrides (app_id/secret/...).
        When provided, a fresh (non-singleton) instance is built so each
        instance can carry its own credentials.
    :param members: teammate Agent ids the owner may delegate to (team bot).
    :param peers: connection profiles for teammates in another process, so the
        owner can delegate to them through the transport.
    :return: channel instance
    """
    multi_instance = bool(instance_id or credentials or bound_agent_id or members or peers)
    ch = _build_channel(channel_type, multi_instance)
    ch.channel_type = _normalize_type(channel_type)
    if multi_instance:
        ch.apply_instance(
            instance_id=instance_id or ch.channel_type,
            bound_agent_id=bound_agent_id,
            credentials=credentials,
            members=members,
            peers=peers,
        )
    return ch


def _normalize_type(channel_type: str) -> str:
    if channel_type in (const.WEIXIN, "wx"):
        return const.WEIXIN
    return channel_type


def _fresh(factory):
    """Return a non-singleton instance when the class is @singleton-wrapped,
    else just call it. Lets several instances of one channel type coexist."""
    new_instance = getattr(factory, "new_instance", None)
    if new_instance is not None:
        return new_instance()
    return factory()


def _build_channel(channel_type, multi_instance) -> Channel:
    """
    create a channel instance
    :param channel_type: channel type code
    :return: channel instance
    """
    ch = Channel()
    if channel_type == "terminal":
        from channel.terminal.terminal_channel import TerminalChannel
        ch = TerminalChannel()
    elif channel_type == 'web':
        from channel.web.web_channel import WebChannel
        ch = WebChannel()
    elif channel_type == "wechatmp":
        from channel.wechatmp.wechatmp_channel import WechatMPChannel
        ch = WechatMPChannel(passive_reply=True)
    elif channel_type == "wechatmp_service":
        from channel.wechatmp.wechatmp_channel import WechatMPChannel
        ch = WechatMPChannel(passive_reply=False)
    elif channel_type == "wechatcom_app":
        from channel.wechatcom.wechatcomapp_channel import WechatComAppChannel
        ch = WechatComAppChannel()
    elif channel_type == const.WECHAT_KF:
        from channel.wechat_kf.wechat_kf_channel import WechatKfChannel
        ch = WechatKfChannel()
    elif channel_type == const.FEISHU:
        from channel.feishu.feishu_channel import FeiShuChanel
        ch = _fresh(FeiShuChanel) if multi_instance else FeiShuChanel()
    elif channel_type == const.DINGTALK:
        from channel.dingtalk.dingtalk_channel import DingTalkChanel
        ch = _fresh(DingTalkChanel) if multi_instance else DingTalkChanel()
    elif channel_type == const.WECOM_BOT:
        from channel.wecom_bot.wecom_bot_channel import WecomBotChannel
        ch = _fresh(WecomBotChannel) if multi_instance else WecomBotChannel()
    elif channel_type == const.QQ:
        from channel.qq.qq_channel import QQChannel
        ch = _fresh(QQChannel) if multi_instance else QQChannel()
    elif channel_type == const.TELEGRAM:
        from channel.telegram.telegram_channel import TelegramChannel
        ch = _fresh(TelegramChannel) if multi_instance else TelegramChannel()
    elif channel_type == const.SLACK:
        from channel.slack.slack_channel import SlackChannel
        ch = _fresh(SlackChannel) if multi_instance else SlackChannel()
    elif channel_type == const.DISCORD:
        from channel.discord.discord_channel import DiscordChannel
        ch = _fresh(DiscordChannel) if multi_instance else DiscordChannel()
    elif channel_type in (const.WEIXIN, "wx"):
        from channel.weixin.weixin_channel import WeixinChannel
        ch = _fresh(WeixinChannel) if multi_instance else WeixinChannel()
        channel_type = const.WEIXIN
    elif channel_type in _EXTENSION_CHANNELS:
        ext_cls = _EXTENSION_CHANNELS[channel_type]
        ch = _fresh(ext_cls) if multi_instance else ext_cls()
    else:
        raise RuntimeError(f"unsupported channel_type: {channel_type!r}")
    ch.channel_type = channel_type
    return ch
