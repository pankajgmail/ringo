set -e
F=/opt/homebrew/bin/ffmpeg
$F -loglevel error -y -f lavfi -i "aevalsrc='0.06*(sin(2*PI*261.6*t)+sin(2*PI*329.6*t)+sin(2*PI*392*t)+0.6*sin(2*PI*493.9*t))*lt(mod(t,8),2)+0.06*(sin(2*PI*220*t)+sin(2*PI*261.6*t)+sin(2*PI*329.6*t)+0.6*sin(2*PI*392*t))*gte(mod(t,8),2)*lt(mod(t,8),4)+0.06*(sin(2*PI*174.6*t)+sin(2*PI*220*t)+sin(2*PI*261.6*t)+0.6*sin(2*PI*329.6*t))*gte(mod(t,8),4)*lt(mod(t,8),6)+0.06*(sin(2*PI*196*t)+sin(2*PI*246.9*t)+sin(2*PI*293.7*t)+0.6*sin(2*PI*392*t))*gte(mod(t,8),6)+0.05*sin(2*PI*65.4*t)*(0.5+0.5*sin(2*PI*2*t))':s=44100:d=30" -af "lowpass=f=1800,aecho=0.8:0.7:120:0.3,afade=t=in:d=1.5,afade=t=out:st=27.5:d=2.5,volume=0.8" -ac 2 music.wav
IN=""; FL=""; n=0
for ms in 300 4300 8600 15300 19900 22800 27300; do
  n=$((n+1)); IN="$IN -i vo/$n.aiff"; FL="$FL[$n:a]aresample=44100,adelay=$ms|$ms,volume=1.6[v$n];"
done
$F -loglevel error -y -i music.wav $IN -filter_complex "${FL}[v1][v2][v3][v4][v5][v6][v7]amix=inputs=7:normalize=0[vo];[0:a]volume=0.55[m];[m][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]" -map "[a]" -t 30 -ac 2 mix.wav
$F -loglevel error -y -framerate 30 -i frames/f%04d.jpg -i mix.wav -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -profile:v high -movflags +faststart -c:a aac -b:a 160k -shortest ringvo-demo.mp4
$F -loglevel error -y -i ringvo-demo.mp4 -vf scale=1280:-2 -c:v libx264 -crf 24 -preset slow -movflags +faststart -c:a aac -b:a 128k ringvo-demo-720.mp4
$F -loglevel error -y -i frames/f0300.jpg -vf scale=1280:-2 -q:v 3 poster.jpg
