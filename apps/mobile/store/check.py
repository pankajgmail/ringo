import re,sys
s=open(sys.argv[1]).read()
lim={"Name":30,"Subtitle":30,"Promotional text":170,"Keywords":100,"Description":4000,"App name":30,"Short description":80,"What's New":4000}
for m in re.finditer(r"\*\*(.+?)\*\*(?: \(.*?\))?\n(.+?)(?=\n\*\*|\n## |\Z)",s,re.S):
  k=m.group(1); v=m.group(2).strip()
  if k in lim: print(f"{k}: {len(v.encode())}/{lim[k]}", "OK" if len(v.encode())<=lim[k] else "TOO LONG")
