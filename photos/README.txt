PUT YOUR PHOTOS IN THIS FOLDER
==============================

1. Export your photos as JPEG (or TIFF/PNG/WebP), at full resolution or at
   least 3000 px on the long edge. RAW and HEIC files must be exported first.
2. Copy them here.
3. Run:  npm run build

Order    Photos appear in file-name order. Start names with numbers:
         01-harbour.jpg, 02-dunes.jpg ... (the number is not shown anywhere).
Hide     Start a name with "_" to leave it out: _maybe-later.jpg
Text     Title, caption, location and date are read from the photo's own
         metadata (e.g. Lightroom's Title / Caption / Location fields).
         To change or add text without re-exporting, edit details.json
         in this folder; instructions are at the top of that file.
Privacy  The files in this folder are never published or committed to git.
         The website only gets resized copies with location (GPS) and all
         other metadata removed (Artist and Copyright are kept).
