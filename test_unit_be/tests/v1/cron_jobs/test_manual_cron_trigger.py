import pytest

from app.common.business_exceptions import NotFoundError
from app.cron.runner import trigger_manual_cron_job


@pytest.mark.asyncio
async def test_trigger_manual_cron_job_rejects_unknown_job():
    with pytest.raises(NotFoundError, match="not found"):
        await trigger_manual_cron_job("not-a-real-job")
