import sys
import os

# Add src to the system path so we can import from it
sys.path.append(os.path.join(os.path.dirname(__file__), "src"))

from main import PhotoSorter, QApplication

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = PhotoSorter()
    window.show()
    sys.exit(app.exec())
