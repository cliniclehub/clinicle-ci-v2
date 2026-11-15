"""
Render Cron CLI — one-shot background jobs.

Usage:
  python -m app.cron dispatch          # recommended: single Render cron service
  python -m app.cron email-queue
  python -m app.cron auth-cleanup
  python -m app.cron notification-dispatch
  python -m app.cron notification-reconcile
  python -m app.cron cron-history-cleanup
  python -m app.cron hls-transcode
"""

import argparse
import asyncio
import sys

from app.common.app_logger import get_logger
from app.cron.registry import register_default_jobs
from app.cron.runner import dispatch_due_jobs, execute_job
from app.v1.cron_jobs.constants import DISPATCH_JOB_ORDER

logger = get_logger(__name__)

CLI_JOB_NAMES = DISPATCH_JOB_ORDER

register_default_jobs()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a one-shot platform cron job")
    parser.add_argument(
        "job",
        choices=("dispatch", *CLI_JOB_NAMES),
        help="Job to run, or 'dispatch' to run all due jobs",
    )
    args = parser.parse_args()

    logger.info(f"Starting cron: {args.job}")
    try:
        if args.job == "dispatch":
            summary = asyncio.run(dispatch_due_jobs())
        else:
            summary = asyncio.run(execute_job(args.job))
        logger.info(f"Cron {args.job} completed", extra={"summary": summary})
        return 0
    except Exception as e:
        logger.error(f"Cron {args.job} failed: {e!s}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
