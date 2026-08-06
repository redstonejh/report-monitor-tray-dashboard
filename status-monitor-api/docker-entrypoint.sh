#!/bin/sh
set -eu

# Existing Portainer deployments created the history volume from a root-running
# node image. Repair that persisted ownership before dropping privileges.
chown -R node:node /data

exec gosu node "$@"
