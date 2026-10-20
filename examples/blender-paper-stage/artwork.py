"""Original Field Notes print assets. Exact sources remain editable/reproducible."""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--revision',type=int,default=1);args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
font='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
W,H=840,1120
im=Image.new('RGB',(W,H));px=im.load()
# Quiet blue ink becomes orange at the upper edge and deep green below.
for y in range(H):
 for x in range(W):
  t=x/W;u=y/H
  a=(25,65,73);b=(195,71,37);c=(43,91,66)
  v=[a[i]*(1-t)+b[i]*t for i in range(3)]
  px[x,y]=tuple(round(v[i]*(1-u*.6)+c[i]*u*.6) for i in range(3))
d=ImageDraw.Draw(im);cream=(242,235,196)
d.text((62,62),'FIELD NOTES / 2026',font=ImageFont.truetype(font,27),fill=cream)
lines=['Across','the','ordinary.'] if args.revision==1 else ['Another','perspective.']
for i,text in enumerate(lines):d.text((52,263+i*135),text,font=ImageFont.truetype(font,118),fill=cream,stroke_width=0)
d.text((62,963),'A SERIES OF FRESH\nPERSPECTIVES',font=ImageFont.truetype(font,24),fill=cream,spacing=5)
d.text((685,935),f'{args.revision:02}',font=ImageFont.truetype(font,90),fill=cream)
im.save(out/'cover.png')
# Back/spine provide authored print rather than exposing a repeated front image.
back=Image.new('RGB',(W,H),(235,225,191));bd=ImageDraw.Draw(back)
bd.text((62,70),'COLLECTED OBSERVATIONS',font=ImageFont.truetype(font,27),fill=(31,52,46))
for y in [860,884,908]:bd.line((62,y,700,y),fill=(76,81,60),width=2)
bd.text((62,972),'FIELD NOTES',font=ImageFont.truetype(font,38),fill=(31,52,46));back.save(out/'back.png')
spine=Image.new('RGB',(160,1120),(31,70,65));sd=ImageDraw.Draw(spine);text=Image.new('RGBA',(950,90));ImageDraw.Draw(text).text((0,0),'FIELD NOTES   /   2026',font=ImageFont.truetype(font,48),fill=cream);spine.paste(text.rotate(90,expand=True),(33,85));spine.save(out/'spine.png')
