import sys
from photosorter.main import PhotoSorter, QApplication

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = PhotoSorter()
    window.show()
    sys.exit(app.exec())
