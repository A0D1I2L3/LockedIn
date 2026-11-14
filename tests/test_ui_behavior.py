from __future__ import annotations

from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "app" / "static"


def test_index_has_new_workspace_not_gmail():
    html = (STATIC / "index.html").read_text()
    assert 'id="app-shell"' in html
    assert 'id="add-app-btn"' in html
    assert 'id="detail-modal"' in html
    assert 'id="email-text"' in html
    assert 'class="stage-assessment"' in html or "stage-assessment" in html
    assert "Gmail" not in html
    assert "Sync now" not in html


def test_frontend_uses_tracker_endpoints():
    source = (STATIC / "app.js").read_text()
    html = (STATIC / "index.html").read_text()
    for endpoint in (
        "/api/applications",
        "/api/parse-email",
        "/api/notifications",
        "/api/settings",
    ):
        assert endpoint in source
    assert "/api/calendar.ics" in html
    assert "gmail" not in source.lower()
    assert "notification" in source.lower()
    assert "serviceWorker" in source


def test_service_worker_and_icon_exist():
    assert (STATIC / "sw.js").exists()
    assert "notificationclick" in (STATIC / "sw.js").read_text()
    assert (STATIC / "icon.svg").exists()


def test_settings_offer_llm_providers():
    html = (STATIC / "index.html").read_text()
    source = (STATIC / "app.js").read_text()
    assert 'id="p-llm-provider"' in html
    for provider in ("openai", "grok", "claude"):
        assert f'value="{provider}"' in html
    assert "LLM_PROVIDER_DEFAULTS" in source
    assert "/messages" not in source
