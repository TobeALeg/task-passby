#!/bin/sh
set -eu
install -d -m 750 -o root -g worket-edge /var/lib/worket-edge/tls
for file in fullchain.pem privkey.pem; do
  install -m 640 -o root -g worket-edge "/etc/letsencrypt/live/worket-ip/$file" "/var/lib/worket-edge/tls/$file.next"
  mv "/var/lib/worket-edge/tls/$file.next" "/var/lib/worket-edge/tls/$file"
done
systemctl reload worket-edge
