from __future__ import annotations

from app.classify import classify, extract_company, guess_role, humanize_domain
from app.models import EmailMessage


def _email(subject: str, snippet: str = "", from_email: str = "recruiter@acme.com") -> EmailMessage:
    return EmailMessage(
        id="1",
        thread_id="t1",
        subject=subject,
        from_name="",
        from_email=from_email,
        from_domain=from_email.rsplit("@", 1)[-1],
        date_ts=0,
        snippet=snippet,
    )


class TestCompany:
    def test_registrable_domain(self):
        assert extract_company("hello@janestreet.com", "") == "Jane Street"

    def test_subdomain_stripped(self):
        assert extract_company("careers@careers.acme.com", "") == "Acme"

    def test_override_map(self):
        assert extract_company("no-reply@linkedin.com", "") == "LinkedIn"
        assert extract_company("x@google.com", "") == "Google"

    def test_personal_falls_back_to_name(self):
        assert extract_company("sarah@gmail.com", "Sarah Jones") == "Sarah Jones"

    def test_humanize(self):
        assert humanize_domain("janestreet") == "Jane Street"
        assert humanize_domain("acme") == "Acme"


class TestClassify:
    def test_application(self):
        assert classify(_email("Your application for Software Engineer Intern has been received")) == "application"

    def test_offer(self):
        assert classify(_email("We are excited to welcome you aboard!")) == "offer"

    def test_rejection(self):
        assert classify(_email("Update on your candidacy — we will not be moving forward")) == "rejection"

    def test_interview(self):
        assert classify(_email("Interview scheduling with Google")) == "interview"

    def test_unknown(self):
        assert classify(_email("Friday team lunch")) == "other"


class TestRole:
    def test_role_from_subject(self):
        assert guess_role("Your application for Software Engineering Intern") == "Software Engineering Intern"

    def test_no_role(self):
        assert guess_role("Welcome to our platform") == ""