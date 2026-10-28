set -e
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gnome-keyring >/dev/null
exec dbus-run-session -- bash -c '
set -e
export XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
printf "disposable-fixture-vault" | gnome-keyring-daemon --unlock --components=secrets
ACT_DOCK_TEST_VAULT=1 /fixtures/helper.test -test.v
'
