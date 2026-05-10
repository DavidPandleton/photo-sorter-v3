import logging
import sys
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path.home() / ".photosorter" / "logs"
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 3


def setup_logging(level: int = logging.INFO) -> str:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "photosorter.log"

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s:%(lineno)d | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        str(log_path), maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    logging.getLogger("PIL").setLevel(logging.WARNING)
    logging.getLogger("rawpy").setLevel(logging.WARNING)

    sys.excepthook = _crash_handler

    logging.info(f"Logging initialized. Log file: {log_path}")
    return str(log_path)


def _crash_handler(exc_type, exc_value, exc_tb):
    log_path = LOG_DIR / "crash.txt"
    try:
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"Unhandled exception: {exc_type.__name__}: {exc_value}\n")
            traceback.print_tb(exc_tb, file=f)
    except Exception:
        pass
    logging.critical(
        "Unhandled exception",
        exc_info=(exc_type, exc_value, exc_tb),
    )
    sys.__excepthook__(exc_type, exc_value, exc_tb)
