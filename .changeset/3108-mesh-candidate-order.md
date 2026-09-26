---
'@robota-sdk/agent-transport-webrtc': patch
---

A WebRTC peer hands out its own ICE candidates only once it holds the remote description, so an answerer can no
longer reach the offerer while the answer is still being applied and have its certificate refused. A data channel
closed right after a send no longer loses that send: it reads closed at once and its stream is reset after a
grace. A LAN probe answered with anything but a valid proof is dropped at once.
