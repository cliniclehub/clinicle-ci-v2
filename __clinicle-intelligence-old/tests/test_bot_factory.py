# encoding:utf-8
"""models/bot_factory.py: create_bot's dispatch table. Regression-pins that
adding claude_code_cli did not disturb any existing branch -- a pure
if/elif addition should never change what an existing bot_type resolves to."""

import pytest

from common import const
from models.bot_factory import create_bot


@pytest.mark.parametrize("bot_type, expected_class_name", [
    (const.DEEPSEEK, "DeepSeekBot"),
    (const.CLAUDEAPI, "ClaudeAPIBot"),
    (const.GEMINI, "GoogleGeminiBot"),
    (const.MOONSHOT, "MoonshotBot"),
    (const.DOUBAO, "DoubaoBot"),
    (const.LOCAL, "ChatGPTBot"),  # LOCAL routes through the OpenAI-compatible bot
])
def test_existing_bot_types_are_unaffected_by_the_new_branch(bot_type, expected_class_name):
    bot = create_bot(bot_type)
    assert type(bot).__name__ == expected_class_name


def test_claude_code_cli_resolves_to_its_own_bot():
    from models.claude_code_cli_bot import ClaudeCodeCliBot

    bot = create_bot(const.CLAUDE_CODE_CLI)
    assert isinstance(bot, ClaudeCodeCliBot)


def test_unknown_bot_type_still_raises():
    with pytest.raises(RuntimeError):
        create_bot("not-a-real-bot-type")
