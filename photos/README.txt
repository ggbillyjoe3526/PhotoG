PUT YOUR PHOTOS IN THIS FOLDER
==============================

1. Export your photos as JPEG (or TIFF/PNG/WebP), at full resolution or at
   least 3000 px on the long edge. RAW and HEIC files must be exported first.
2. Copy them here.
3. Run:  npm run build

Order    Photos appear in file-name order. Start names with numbers:
         01-harbour.jpg, 02-dunes.jpg ... (the number is not shown anywhere).
         Each name must be different once the number is removed.
Hide     Start a name with "_" to leave it out: _maybe-later.jpg
         (camera names such as _DSC1234.jpg are not hidden). Folders inside
         this folder are ignored.
Text     Title, caption, location and date are read from the photo's own
         metadata (e.g. Lightroom's Title / Caption / Location fields).
         To change or add text without re-exporting, edit details.json
         in this folder; instructions are at the top of that file.
Privacy  Your photos in this folder are never committed to git or published.
         The website only gets resized copies with location (GPS) and all
         other metadata removed (Artist and Copyright are kept). The page
         shows the city and month from your photos' metadata by default;
         change that with "show" in site.json. details.json and this file
         are kept in git (so your text is backed up) but are not part of
         the published website.
