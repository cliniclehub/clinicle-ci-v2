# encoding:utf-8
"""channel/web/static/js/views/models-custom-provider.js's CUSTOM_PROVIDER_PRESETS:
quick-fill name/api_base pairs for the "Add custom provider" modal. Every
base_url here was verified live against the provider's own docs before being
hardcoded (a wrong preset is worse than none) -- this test just guards the
wiring (all presets present, modal references the dropdown, edit mode hides
it), not the URLs themselves, which aren't re-verifiable from a unit test."""

import re
from pathlib import Path

ROOT = Path(__file__).parents[1]

_EXPECTED_PRESETS = {
    "Tencent Hunyuan": "https://api.hunyuan.cloud.tencent.com/v1",
    "Lingyi Wanwu (01.AI)": "https://api.lingyiwanwu.com/v1",
    "StepFun": "https://api.stepfun.com/v1",
    "SiliconFlow": "https://api.siliconflow.cn/v1",
    "PPIO": "https://api.ppio.com/openai",
    "Volcengine Ark": "https://ark.cn-beijing.volces.com/api/v3",
    "Poe": "https://api.poe.com/v1",
    "Novita AI": "https://api.novita.ai/openai/v1",
    "OpenRouter": "https://openrouter.ai/api/v1",
    "xAI (Grok)": "https://api.x.ai/v1",
    "InfiniAI": "https://cloud.infini-ai.com/maas/v1",
}


def _js_source():
    return (ROOT / "channel/web/static/js/views/models-custom-provider.js").read_text(encoding="utf-8")


def _html_source():
    return (ROOT / "channel/web/templates/modals/custom-provider.html").read_text(encoding="utf-8")


def test_every_verified_preset_is_present_with_its_verified_url():
    js = _js_source()
    for name, api_base in _EXPECTED_PRESETS.items():
        assert f"name: '{name}'" in js, f"preset {name!r} missing"
        assert api_base in js, f"base_url for {name!r} not found in JS"


def test_excluded_providers_are_not_shipped_as_presets():
    """AWS Bedrock and self-hosted gateways don't expose a fixed Bearer-token
    OpenAI-compatible endpoint -- shipping either as a one-click preset would
    silently produce a broken provider. (They're allowed to appear in a
    comment explaining the exclusion -- only an actual preset entry matters.)"""
    js = _js_source()
    assert "name: 'AWS Bedrock'" not in js
    assert "name: 'NewAPI'" not in js


def test_modal_has_a_preset_dropdown_wired_to_the_apply_function():
    html = _html_source()
    js = _js_source()
    assert 'id="custom-provider-preset"' in html
    assert "applyCustomProviderPreset" in html
    assert "function applyCustomProviderPreset" in js


def test_preset_dropdown_is_hidden_while_editing_an_existing_provider():
    js = _js_source()
    assert re.search(r"presetWrap\.classList\.toggle\('hidden',\s*editing\)", js)
