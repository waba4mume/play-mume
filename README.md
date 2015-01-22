# play-mume

Modern web client for MUME using DecafMUD.

The target audience is new players who don't want to install desktop
applications to test MUME, and other players who can't use their usual setup
for some reason (not at home etc). It is not intended to replace a
full-featured client + mapper.

## How to Install the Files

The `index.html` of this project expects to be installed alongside with
DecafMUD, like this:

    mume/               # Or whatever
        DecafMUD/       # Clone of https://github.com/waba4mume/DecafMUD/
        play/           # Clone of https://github.com/waba4mume/play-mume/ ,
                        # point your users here (/mume/play/)

There is a "Download ZIP" button in the bottom right section of each of these
links, or just use Git.

Make sure to download the right branch!
- `master` is the stable version (ready to play)
- `input-filter` and `mapper` are the respective in-progress branches for the
  mapper project.

## Setting Up a Web Server

The map display works only if served over HTTP(S), as opposed to just opening
local files in your browser (or you'd have to disable security checks in your
browser).

Setting up a production server is outside of the scope of this document, but
for testing purposes you can use:
- https://code.google.com/p/mongoose/ on Windows (and Mac?)
- `python -m SimpleHTTPServer` or `python -m http.server` on GNU/Linux. After
  one of these commands starts succesfully, point your browser to
  http://127.0.0.1:8000/play/.

## Testing without a WebSocket Server

Just keep the current settings in index.html and you'll use my WebSocket proxy.

## About the WebSocket Server

WebSocket is a modern browser technology that lets Javascript code create data
streams (such as Telnet for MUDs) inside HTTP(S).

### Javascript (Client-Side) Configuration

`index.html` configures the DecafMUD Javascript code to connect to
`https://test.waba.be/mume/play/websocket` with these settings:
- `host` set to `test.waba.be`
- `set_socket.wspath` set to `/mume/play/websocket`
- `set_socket.wsport` set to 443 (*)
- `set_socket.ssl` set to true (*)

### How to Bypass Firewalls

There are two important points (*) here, that makes this client compatible with
most corporate/school firewalls, by looking no different from a connection to
https://www.google.com:
- The WebSocket stream (which carries the Telnet payload) is encrypted (https).
- That HTTPS stream uses the standard port.

### Server Setup

I'm currently using Websockify as the WebSocket endpoint (unproxying the Telnet
connections to mume.org). I'll replace it later by something that supports
MUD features.

If you wish to hide your WebSocket inside HTTPS (as I recommend), you'll need
Apache 2.4, mod_proxy, mod_proxy_wstunnel and a configuration line like this in
your Apache configuration:

    Proxypass /mume/play/websocket ws://localhost:1080 retry=0

