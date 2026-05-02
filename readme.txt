Photo Sorter V1
---------------

This is a simple tool I put together to help with the tedious task of sorting and culling large batches of photos. It supports standard formats like JPG/PNG as well as RAW files (CR2, ARW, NEF).

FEATURES:
- Fast RAW previewing.
- Keyboard-driven sorting (N/P for navigation, 1/2/3 for rating).
- Mouse scroll zooming and left-click panning.
- Automatic folder organization (BAD/OK/GOOD subfolders).
- A simple "Time Machine" checkpoint system to restore files to their original places if needed.

INSTALLATION:
1. Make sure you have Python installed.
2. Install the few dependencies needed:
   pip install -r requirements.txt

HOW TO USE:
- [N] -> Next image
- [P] -> Previous image
- [1] -> Rate BAD
- [2] -> Rate OK
- [3] -> Rate GOOD
- [Ctrl + Scroll] -> Zoom in/out
- [Left Mouse Drag] -> Pan while zoomed
- [F] -> Toggle Fullscreen
- [ESC] -> Exit

It's nothing fancy, but I hope it makes your photo workflow a bit smoother!
