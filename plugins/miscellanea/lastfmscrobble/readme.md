Simple last.fm scrobbler - only doing scrobbling and now playing.
Inspired by the existing lastfm plugin that I failed to get to work consistently.

Tested with tidal, local library and (some) web radios.

Usage requires a last.fm user. Enter username and password in pluging configuration.

It's fairly stable, but it's probably possible to provoke errors.

It's using a fork of lastfm-node-client as I need https for login. Will go back to to node module if author updates.
https://www.npmjs.com/package/lastfm-node-client
It's integrated as a git submodule in my tree, but that needs access to volumio-plugins/.gitmodules
My fork: https://github.com/oisteink/lastfm-node-client.git

