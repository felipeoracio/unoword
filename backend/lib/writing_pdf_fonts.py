"""Licensed, bundled PDF fonts; no runtime font downloads or OS dependency."""
from pathlib import Path
from threading import Lock
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

_lock = Lock()
_ready = False
FAMILIES = {'serif':'UnoSerif','sans':'UnoSans','mono':'UnoMono'}


def pdf_fonts():
    global _ready
    with _lock:
        if not _ready:
            root=Path(__file__).resolve().parent.parent/'assets'/'fonts'
            for family,file,italic,bolditalic in [('UnoSerif','DejaVuSerif','Italic','BoldItalic'),('UnoSans','DejaVuSans','Oblique','BoldOblique'),('UnoMono','DejaVuSansMono','Oblique','BoldOblique')]:
                for name,suffix in [(family,''),(family+'-Bold','-Bold'),(family+'-Italic','-'+italic),(family+'-BoldItalic','-'+bolditalic)]:
                    pdfmetrics.registerFont(TTFont(name,str(root/(file+suffix+'.ttf'))))
                pdfmetrics.registerFontFamily(family,normal=family,bold=family+'-Bold',italic=family+'-Italic',boldItalic=family+'-BoldItalic')
            _ready=True
    return FAMILIES
