`window-colors.mp4` is an original synthetic test fixture: 0.6 seconds of green
followed by 0.6 seconds of orange, 256×128, 30 fps, H.264 yuv420p, no audio.
It contains no third-party imagery. The runtime check uses a real decoded video
rather than treating an image upload as proof of video refresh.

Regenerate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'color=c=0x22cc66:s=256x128:d=0.6:r=30' \
  -f lavfi -i 'color=c=0xff5511:s=256x128:d=0.6:r=30' \
  -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[v]' -map '[v]' \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart window-colors.mp4
```

`window-source.svg` is an original solid-color CORS fixture. The localhost
runtime check loads it from the alternative loopback hostname to exercise a
real origin-tainted texture replacement. Run that check from localhost or
127.0.0.1; the visual demo itself has no cross-origin requests.
