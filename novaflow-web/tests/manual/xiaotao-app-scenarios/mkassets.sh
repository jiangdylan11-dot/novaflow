#!/bin/sh
# Test pictures and clips for the scenarios (git-ignored). Needs ffmpeg.
cd "$(dirname "$0")"
[ -f cat.png ] || ffmpeg -v error -y -f lavfi -i "color=c=0x8090a0:s=512x512,drawbox=x=156:y=156:w=200:h=200:color=0xd08040:t=fill" -frames:v 1 cat.png
ffmpeg -v error -y -f lavfi -i "testsrc=size=320x240:rate=12:duration=2" -pix_fmt yuv420p clip.mp4
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=2" tone.wav
ffmpeg -v error -y -f lavfi -i "color=c=black:s=128x128,drawbox=x=40:y=40:w=50:h=50:color=0xff8c14:t=fill" -frames:v 1 black.png
