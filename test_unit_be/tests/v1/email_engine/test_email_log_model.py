from sqlalchemy.dialects.postgresql import INET

from app.v1.email_engine.model import EmailLog


def test_email_log_ip_address_matches_postgres_inet_column():
    assert isinstance(EmailLog.__table__.c.ip_address.type, INET)
