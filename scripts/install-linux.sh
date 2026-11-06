#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || ! -f $1 ]]; then
  echo "Usage: $0 path/to/Handy-Linux.deb" >&2
  exit 1
fi

prefix="${HOME}/.local/opt/handy-linux"
archive=$(realpath "$1")
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
cd "$staging"
ar x "$archive"
tar -xf data.tar.*
test -x usr/bin/handy-linux
mkdir -p "$prefix" "$HOME/.local/bin" "$HOME/.local/share/applications"
cp -a usr "$prefix/"
cat > "$HOME/.local/bin/handy-linux" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
prefix="$HOME/.local/opt/handy-linux/usr"
export LD_LIBRARY_PATH="$prefix/lib/Handy Linux${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$prefix/bin/handy-linux" "$@"
LAUNCHER
chmod +x "$HOME/.local/bin/handy-linux"
cat > "$HOME/.local/share/applications/handy-linux.desktop" <<DESKTOP
[Desktop Entry]
Name=Handy Linux
Comment=Offline voice typing with an animated Linux overlay
Exec="$HOME/.local/bin/handy-linux"
Icon=$prefix/usr/share/icons/hicolor/128x128/apps/handy-linux.png
Terminal=false
Type=Application
Categories=Utility;Audio;
DESKTOP
printf 'Installed Handy Linux. Launch: %s\n' "$HOME/.local/bin/handy-linux"
