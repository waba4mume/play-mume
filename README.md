# play-mume

Modern web client for MUME using DecafMUD.

## How to Install the Files

The `index.html` of this project expects to be installed alongside with
DecafMUD, like this:

    mume/               # Or whatever
        DecafMUD/       # Clone of https://github.com/waba4mume/DecafMUD/
        play/           # Clone of https://github.com/waba4mume/play-mume/ ,
                        # point your users here (/mume/play/)

## The WebSocket Server

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

### For Testing

Bypassing firewalls doesn't matter much if you're just testing. Or you can just
use my WebSocket.

### Server Setup

I'm currently using Websockify as the WebSocket endpoint (unproxying the Telnet
connections to mume.org). I'll replace it later by something that supports
MUD features.

If you wish to hide your WebSocket inside HTTPS (as I recommend), you'll need
Apache 2.4, mod_proxy, mod_proxy_wstunnel and a configuration line like this in
your Apache configuration:

    Proxypass /mume/play/websocket ws://localhost:1080 retry=0

