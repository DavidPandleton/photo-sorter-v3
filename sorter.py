import sys
import logging
from photosorter.logging_setup import setup_logging
from photosorter.main import PhotoSorter, QApplication

log_path = setup_logging()
logging.info("Photo Sorter V1 starting up")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = PhotoSorter()
    window.show()
    sys.exit(app.exec())
