FROM lscr.io/linuxserver/openssh-server:latest
# Real tmux + bash + git so the persistent-terminal QA suite exercises the
# same stack as an Ubuntu VPS: tmux passthrough, bash integration, git chip.
RUN apk add --no-cache tmux bash git
