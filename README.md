# Play MUME!

A modern web client for MUME using DecafMUD.

The target audience is new players who don't want to install desktop
applications to test MUME, and other players who can't use their usual setup
for some reason (not at home etc). It is not intended to replace a
full-featured client + mapper.

## I Just Want to Play

Go to http://mume.org/Client/ and click `Play MUME!`.

## I Want to Host a Copy of Play MUME!

It is a Bad Idea to host a copy of Play MUME! for general usage, because you'd
encourage players to input their MUME passwords into random websites, exposing
them to credentials phishing.

Please contact me (Waba) before doing this. We'll discuss other options.

Nevertheless:
- You would need a copy of Play MUME!, the Javascript 3rd party libraries, and
  the map data. Visit the
  [releases](https://github.com/waba4mume/play-mume/releases) section on Github
  and download a recent `play-mume-vX.Y.Z.zip` archive, it should contain
  everything you need.
- You would need to host Play MUME! on a HTTP(S) web server, as the browser
  security model is incompatible with local `file:` resources.
- You would need a WebSocket Server.

## I Want to Contribute to Play MUME!

Great! You'll need a little setup described below. If you get stuck, do not
hesitate to contact me (Waba)!

### Forking my repositories

The Github contribution workflow supposes that you sign up on Github and fork
my two repositories, [DecafMUD](https://github.com/waba4mume/DecafMUD/) and
[Play MUME!](https://github.com/waba4mume/play-mume/).

Doing so now will save you time later when you want to send me patches (Pull
Requests).

In this document I'll use `YOU` as a placeholder for your Github username. You
could skip this step and use `waba4mume` as `YOU`, but you'll eventually have
to sign up, fork, and then replace your remote URLs (an advanced topic).

Github has a [4 mins
tutorial](https://guides.github.com/activities/hello-world/) on forking
repositories and sending Pull Requests.

### Getting the Source Code

The `index.html` of this project expects to be installed alongside with
DecafMUD, like this:

    mume/               # Or whatever
        DecafMUD/       # Clone of https://github.com/YOU/DecafMUD/
        play/           # Clone of https://github.com/YOU/play-mume/
            index.html  # point your browser here (/mume/play/)

So, assuming you are in your project directory and are using the `git`
command-line software, run:

    git clone https://github.com/YOU/DecafMUD.git
    git clone https://github.com/YOU/play-mume.git play

Remember to replace `YOU` by your Github username.

Adapt these instructions if you are using a graphical Git client to get the
above directory layout.

### Compiling the Source Code

The best part of Play MUME! is written in TypeScript (`src/*`) and will need to
be compiled to JavaScript (`build/*`) before your browser can use it. You will
need to install TypeScript compiler from https://www.typescriptlang.org and run
in `play`:

    tsc

TypeScript is a superset of JavaScript that compiles to clean JavaScript
output. It helps catching bugs before anybody even tests the code, letting me
produce more features in less time. Try it with a [compatible
editor](https://github.com/Microsoft/TypeScript/wiki/TypeScript-Editor-Support)
and you'll love it too!

### Getting the Third-party Libraries

Play MUME! relies on a few 3rd-party Javascript libraries. As I didn't
integrate with NPM or Yarn yet, you'll have to download them by hand into the
`libs/` directory. See `libs/README.txt` for the instructions.

Or just grab the `libs` folder from a recent
[release](https://github.com/waba4mume/play-mume/releases)'s
`play-mume-vX.Y.Z.zip`.

### Getting Map Data

The map data is an export of a MMapper map into a special web-friendly format
that allows the browser to only load the surrounding area instead of the whole
35k+ rooms.

As the time of writing, that feature has yet to be included in a stable MMapper
release. Instead, you can just grab the `mapdata` folder from a recent release
`.zip`.

### Setting Up a Web Server

The map display works only if served over HTTP(S), as opposed to just opening
local files in your browser (or you'd have to disable security checks in your
browser).

Setting up a production server is outside of the scope of this document, but
for testing purposes you can use:
- https://cesanta.com/ (untested!) for Windows.
- `python -m SimpleHTTPServer` or `python -m http.server` on GNU/Linux from
  your project's directory (ie. `mume/`).

After one of these commands starts succesfully, point your browser to
http://127.0.0.1:8000/play/.

Just keep the current settings in index.html and you'll use my WebSocket proxy.
That will save you trouble setting one up.

### Testing

If everything went well, you should see your very own Play MUME! running on
127.0.0.1 in your browser! Check that the map seems to work.

### Contributing

This is where you reap the benefit of the forks above. Write awesome commits
(possibly in a [feature branch](https://guides.github.com/introduction/flow/)),
send me a Pull Request, *et voilà*!

## About the WebSocket Proxy

WebSocket is a modern browser technology that lets Javascript code create data
streams (such as Telnet for MUDs) inside HTTP(S).

### Javascript (Client-Side) Configuration

`index.html` configures the DecafMUD Javascript code to connect to
`https://waba.be/mume/play/websocket` with these settings:
- `host` set to `waba.be`
- `set_socket.wspath` set to `/mume/play/websocket`
- `set_socket.wsport` set to 443 (`*`)
- `set_socket.ssl` set to true (`*`)

### How to Bypass Firewalls

There are two important points (`*`) here, that makes this client compatible with
most corporate/school firewalls, by looking no different from a connection to
https://www.google.com:
- The WebSocket stream (which carries the Telnet payload) is encrypted (https).
- That HTTPS stream uses the standard port.

### Server Setup

I'm currently using Websockify as the WebSocket endpoint (unproxying the Telnet
connections to mume.org). I'll replace it later by something that supports
MUD features.

If you wish to hide your WebSocket inside HTTPS (as I recommend), you'll need
Apache 2.4, `mod_proxy`, `mod_proxy_wstunnel` and a configuration line like
this in your Apache configuration:

    Proxypass /mume/play/websocket ws://localhost:1080 retry=0

