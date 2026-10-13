#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null || ! command -v node >/dev/null; then
  echo 'Maria needs Git and Node.js 20 or newer.' >&2
  exit 1
fi

maria_repo="${MARIA_REPO_URL:-https://github.com/biseshbhattaraiii/maria.git}"
maria_install_dir="${MARIA_INSTALL_DIR:-$HOME/.local/share/maria}"
maria_bin_dir="${MARIA_BIN_DIR:-$HOME/.local/bin}"

if [ -d "$maria_install_dir/.git" ]; then
  git -C "$maria_install_dir" pull --ff-only
else
  mkdir -p "$(dirname "$maria_install_dir")"
  git clone --depth 1 "$maria_repo" "$maria_install_dir"
fi

mkdir -p "$maria_bin_dir"
chmod +x "$maria_install_dir/bin/maria.js"
ln -sfn "$maria_install_dir/bin/maria.js" "$maria_bin_dir/maria"

echo "Maria installed in $maria_install_dir"
echo "Command linked at $maria_bin_dir/maria"
echo 'Initializing and opening the current project…'
exec node "$maria_install_dir/bin/maria.js" bootstrap "$PWD" --agent "${MARIA_AGENT:-auto}"
