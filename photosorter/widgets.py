import os

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QComboBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

STYLE = """
#FolderPanel { background-color: #121212; border: 1px solid #252525; border-radius: 6px; padding: 4px; }
#SearchBar { background-color: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 6px 10px; color: #eee; }
#SearchBar:focus { border-color: #42a5f5; }
#FilterCombo { background-color: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 4px 8px; color: #eee; }
#FilterCombo:focus { border-color: #42a5f5; }
#SectionTitle { color: #666; font-size: 10px; font-weight: bold; letter-spacing: 1px; padding: 4px 0; }
"""


class FolderBrowser(QWidget):
    folder_selected = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("FolderPanel")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)

        title = QLabel("FOLDERS")
        title.setObjectName("SectionTitle")
        layout.addWidget(title)

        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setIndentation(16)
        self.tree.setAnimated(True)
        self.tree.setStyleSheet("""
            QTreeWidget { background: transparent; border: none; color: #ccc; font-size: 12px; }
            QTreeWidget::item { padding: 4px; border-radius: 3px; }
            QTreeWidget::item:hover { background: #252525; }
            QTreeWidget::item:selected { background: #1e88e5; color: white; }
        """)
        self.tree.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self.tree)

        self._root_path = ""

    def load_folder(self, root_path: str):
        self._root_path = root_path
        self.tree.clear()
        root_item = QTreeWidgetItem([os.path.basename(root_path) or root_path])
        root_item.setData(0, Qt.ItemDataRole.UserRole, root_path)
        root_item.setExpanded(True)
        self.tree.addTopLevelItem(root_item)
        self._populate(root_path, root_item)

    def _populate(self, dir_path: str, parent_item: QTreeWidgetItem):
        try:
            for entry in sorted(os.listdir(dir_path)):
                full = os.path.join(dir_path, entry)
                if os.path.isdir(full) and not entry.startswith("."):
                    child = QTreeWidgetItem([entry])
                    child.setData(0, Qt.ItemDataRole.UserRole, full)
                    parent_item.addChild(child)
                    self._populate(full, child)
        except PermissionError:
            pass

    def _on_item_clicked(self, item: QTreeWidgetItem, column: int):
        path = item.data(0, Qt.ItemDataRole.UserRole)
        if path and os.path.isdir(path):
            self.folder_selected.emit(path)


class SearchBar(QWidget):
    search_changed = pyqtSignal(str)
    filter_changed = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(4)

        title = QLabel("SEARCH & FILTER")
        title.setObjectName("SectionTitle")
        layout.addWidget(title)

        self.search_input = QLineEdit()
        self.search_input.setObjectName("SearchBar")
        self.search_input.setPlaceholderText("Search filename or EXIF...")
        self.search_input.textChanged.connect(self.search_changed.emit)
        layout.addWidget(self.search_input)

        filter_row = QHBoxLayout()
        filter_row.setSpacing(4)

        self.filter_combo = QComboBox()
        self.filter_combo.setObjectName("FilterCombo")
        self.filter_combo.addItems(["All", "Unrated", "Picked", "BAD", "OK", "GOOD"])
        self.filter_combo.currentTextChanged.connect(self.filter_changed.emit)
        filter_row.addWidget(QLabel("Show:"))
        filter_row.addWidget(self.filter_combo, 1)
        layout.addLayout(filter_row)

    def set_search_text(self, text: str):
        self.search_input.setText(text)


class DateBrowser(QWidget):
    date_selected = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("FolderPanel")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)

        title = QLabel("BY DATE")
        title.setObjectName("SectionTitle")
        layout.addWidget(title)

        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setIndentation(16)
        self.tree.setAnimated(True)
        self.tree.setStyleSheet("""
            QTreeWidget { background: transparent; border: none; color: #ccc; font-size: 12px; }
            QTreeWidget::item { padding: 3px; border-radius: 3px; }
            QTreeWidget::item:hover { background: #252525; }
            QTreeWidget::item:selected { background: #1e88e5; color: white; }
        """)
        self.tree.itemClicked.connect(self._on_item_clicked)
        layout.addWidget(self.tree)

    def load_dates(self, dates: list[dict]):
        self.tree.clear()
        years = {}
        for d in dates:
            y = d["year"]
            m = d["month"]
            day = d["day"]
            if y not in years:
                year_item = QTreeWidgetItem([y])
                year_item.setData(0, Qt.ItemDataRole.UserRole, y)
                year_item.setExpanded(False)
                self.tree.addTopLevelItem(year_item)
                years[y] = {}
            if m not in years[y]:
                month_item = QTreeWidgetItem([f"{m}"])
                month_item.setData(0, Qt.ItemDataRole.UserRole, f"{y}-{m}")
                years[y][m] = month_item
                years[y][m].parent().addChild(month_item) if hasattr(years[y][m], 'parent') else None
                year_item = None
                for i in range(self.tree.topLevelItemCount()):
                    if self.tree.topLevelItem(i).data(0, Qt.ItemDataRole.UserRole) == y:
                        year_item = self.tree.topLevelItem(i)
                        break
                if year_item:
                    year_item.addChild(month_item)
            day_text = f"{y}-{m}-{day}"
            day_item = QTreeWidgetItem([day])
            day_item.setData(0, Qt.ItemDataRole.UserRole, day_text)
            month_item.addChild(day_item)

    def _on_item_clicked(self, item: QTreeWidgetItem, column: int):
        date_val = item.data(0, Qt.ItemDataRole.UserRole)
        if date_val:
            self.date_selected.emit(date_val)
