"""Gera os PDFs de teste da Fase 4 (src/lib/pdf/__fixtures__).

Requer: pip install reportlab
Uso:    python scripts/gerar-fixtures-pdf.py

Cada PDF tem página de 200 x 100 pt (200 x 100 px em escala 1) com retângulos
de 50 x 50 pt alinhados à grade de pixels, sobre papel branco, para que a
proporção de pixels de cada cor seja conhecida exatamente (2500 px cada, em
20000 px de página).
"""
from pathlib import Path
from reportlab.lib.colors import CMYKColor, Color
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "src/lib/pdf/__fixtures__"
OUT.mkdir(parents=True, exist_ok=True)

# (x, y) do canto inferior esquerdo, em pt. A página tem 200 x 100.
SLOTS = [(0, 50), (50, 50), (100, 50), (150, 50), (0, 0), (50, 0)]


def gera(nome, cores, cor_fn):
    c = canvas.Canvas(str(OUT / nome), pagesize=(200, 100), invariant=1, pageCompression=0)
    for (x, y), cor in zip(SLOTS, cores):
        c.setFillColor(cor_fn(cor))
        c.rect(x, y, 50, 50, stroke=0, fill=1)
    c.save()


# RGB (0-255): vermelho, verde, azul, laranja, cinza 50%, marrom
RGB = [(200, 30, 30), (30, 150, 60), (30, 60, 200), (255, 128, 0), (128, 128, 128), (139, 69, 19)]
gera("cores-rgb.pdf", RGB, lambda v: Color(v[0] / 255, v[1] / 255, v[2] / 255))

# CMYK (0-100): ciano, magenta, amarelo, preto, 40/70/0/10, 0/50/100/0
CMYK = [(100, 0, 0, 0), (0, 100, 0, 0), (0, 0, 100, 0), (0, 0, 0, 100), (40, 70, 0, 10), (0, 50, 100, 0)]
gera("cores-cmyk.pdf", CMYK, lambda v: CMYKColor(v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100))

# Misto: 2 retângulos em RGB e 2 em CMYK (usado para testar o aviso de PDF misto).
c = canvas.Canvas(str(OUT / "misto.pdf"), pagesize=(200, 100), invariant=1, pageCompression=0)
c.setFillColor(Color(200 / 255, 30 / 255, 30 / 255)); c.rect(0, 50, 50, 50, stroke=0, fill=1)
c.setFillColor(Color(30 / 255, 60 / 255, 200 / 255)); c.rect(50, 50, 50, 50, stroke=0, fill=1)
c.setFillColor(CMYKColor(1, 0, 0, 0)); c.rect(100, 50, 50, 50, stroke=0, fill=1)
c.setFillColor(CMYKColor(0, 0, 0, 1)); c.rect(150, 50, 50, 50, stroke=0, fill=1)
c.save()

# Imagens CMYK: duas metades de 100 x 50 px (50 x 50 pt ocupam 25% da página cada
# se desenhadas em 100 x 50 pt). Uma em Flate (sem perdas) e uma em JPEG (DCT).
from PIL import Image
def img_cmyk():
    im = Image.new("CMYK", (100, 50))
    im.paste((255, 0, 0, 0), (0, 0, 50, 50))     # ciano 100%
    im.paste((0, 128, 255, 0), (50, 0, 100, 50))  # 0/50/100/0 aprox.
    return im
img_cmyk().save(OUT / "_tmp.tif", compression=None)
c = canvas.Canvas(str(OUT / "imagem-cmyk-flate.pdf"), pagesize=(200, 100), invariant=1)
c.drawImage(str(OUT / "_tmp.tif"), 0, 50, width=100, height=50)
c.save()
img_cmyk().save(OUT / "_tmp.jpg", quality=95)
c = canvas.Canvas(str(OUT / "imagem-cmyk-jpeg.pdf"), pagesize=(200, 100), invariant=1)
c.drawImage(str(OUT / "_tmp.jpg"), 0, 50, width=100, height=50)
c.save()
for t in ("_tmp.tif", "_tmp.jpg"):
    (OUT / t).unlink()
print("ok:", sorted(p.name for p in OUT.iterdir()))
