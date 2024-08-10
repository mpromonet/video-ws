video-ws
===

It connects to a websocket server serving encoded frames and render using webcodecs

A simple page could be:
```
<html>
<head>
    <title>Video ws</title>
    <link rel="icon" href="data:,">
    <script type="module" src="./video-ws.js"></script>
</head>
<body>
    <video-ws id="videows"></video-ws>
</body>
<script type="module">
    const stream = location.search.slice(1) || "/stream0";
    videows.setAttribute("url", stream);
    document.title = stream.substring(1);
</script>
</html>
```

Websocket server should send :
- binary annexb H264 & H265 frames, JPEG frames, audio frames
- json for metadata
```
{
  "codec": "avc1.420029",
  "media": "video",
  "ts": 1723304995845852
}
```

It was done to work with https://github.com/mpromonet/rtsp2web and https://github.com/mpromonet/rtsp2web-rs
