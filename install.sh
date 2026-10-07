#!/bin/sh
# curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh
# User-local macOS/Linux bootstrap. The whole script is parsed before main runs;
# subprocesses never consume the piped installer from stdin.
set -eu
umask 077

say() { printf '%s\n' "Prism: $*"; }
fail() { printf '%s\n' "Prism: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "requires $1; install it and rerun this script"; }
download() { curl -fsSL --retry 3 --connect-timeout 10 --max-time 120 "$1" -o "$2" </dev/null; }
sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 < "$1" | awk '{print $1}'
    else openssl dgst -sha256 < "$1" | awk '{print $NF}'; fi
}
compatible_node() {
    printf '%s\n' "$1" | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ {sub(/^v/, ""); split($0,v,"."); if(v[1]>22 || (v[1]==22 && v[2]>=13)) good=1} END {exit !good}'
}
help() {
    cat <<'EOF'
Install or update Herdr Prism on macOS/Linux x64 or arm64.

  curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh -s -- --inspector-only

Options:
  --ref REF             Git revision to install (default: main)
  --session NAME        Target a named local Herdr session
  --inspector-only      Keep the existing native sidebar layout
  --prepare-only        Set up dependencies without starting/installing Prism
  --no-start            Require the selected Herdr server to be running
  --node-bin PATH       Use this compatible Node executable
  --herdr-bin PATH      Use this Herdr executable
  --source-dir PATH     Use a reviewed local source tree instead of downloading
  --help                Show this help

No sudo or shell-profile changes. A missing server is started headlessly.
Rerunning updates Prism, preserving private Notes, preferences, panels and focus.
Updates retain the saved mode; --inspector-only applies to a first installation.
EOF
}
parse_options() {
    prism_ref=main; prism_source=; prism_node=; prism_help=0
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --help|-h) prism_help=1 ;;
            --ref|--source-dir|--node-bin|--herdr-bin|--session)
                prism_option=$1; shift; [ "$#" -gt 0 ] && [ -n "$1" ] || fail "missing value for $prism_option"
                case "$prism_option" in
                    --ref) prism_ref=$1 ;;
                    --source-dir) prism_source=$1 ;;
                    --node-bin) prism_node=$1 ;;
                esac ;;
            --inspector-only|--prepare-only|--no-start) ;;
            *) fail "unknown option: $1" ;;
        esac
        shift
    done
    case "$prism_ref" in ''|-*|*[!A-Za-z0-9_./-]*) fail 'invalid Git revision' ;; esac
    [ "${#prism_ref}" -le 128 ] || fail 'Git revision exceeds 128 characters'
}
cleanup() {
    if [ -n "${prism_temp:-}" ]; then rm -rf "$prism_temp"; fi
    if [ -n "${prism_node_lock:-}" ]; then rmdir "$prism_node_lock" 2>/dev/null || true; fi
}
install_node() {
    prism_node_version=v24.21.0
    # Official https://nodejs.org/dist/v24.21.0/SHASUMS256.txt, checked 2026-10-06.
    case "$prism_target" in
        darwin-arm64) prism_node_sha=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057; prism_node_binary_sha=e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b ;;
        darwin-x64) prism_node_sha=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097; prism_node_binary_sha=7abcf39bd37ab251015337ff75304d7555f0d8e88c6e0fbf04bce8ce34636f49 ;;
        linux-arm64) prism_node_sha=724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5; prism_node_binary_sha=0f8949d1028f6d61506b2d5bc57e7e6fe893d7b1997509b7847294fc9c616584 ;;
        linux-x64) prism_node_sha=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff; prism_node_binary_sha=7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c ;;
    esac
    prism_deps="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-prism/dependencies"
    case "$prism_deps" in /*) ;; *) fail 'XDG_DATA_HOME must be an absolute path' ;; esac
    [ ! -L "$prism_deps" ] || fail "refusing symlink dependency directory: $prism_deps"
    mkdir -p "$prism_deps"
    prism_node_dir="$prism_deps/node-$prism_node_version-$prism_target"
    prism_node="$prism_node_dir/bin/node"
    if [ -e "$prism_node_dir" ] || [ -L "$prism_node_dir" ]; then
        [ -d "$prism_node_dir" ] && [ ! -L "$prism_node_dir" ] && [ -f "$prism_node" ] && [ ! -L "$prism_node" ] && [ -f "$prism_node_dir/.prism-runtime.sha256" ] || fail 'unsafe existing Node runtime; refusing replacement'
        [ "$(sha256 "$prism_node")" = "$prism_node_binary_sha" ] || fail 'existing Node runtime checksum differs; refusing replacement'
        return
    fi
    mkdir "$prism_node_dir.install-lock" 2>/dev/null || fail 'another Node installation owns the dependency lock'
    prism_node_lock="$prism_node_dir.install-lock"
    say "installing verified Node $prism_node_version for this user"
    prism_node_archive="$prism_temp/node.tar.gz"
    download "https://nodejs.org/dist/$prism_node_version/node-$prism_node_version-$prism_target.tar.gz" "$prism_node_archive"
    [ "$(sha256 "$prism_node_archive")" = "$prism_node_sha" ] || fail 'Node download checksum mismatch; nothing was installed'
    mkdir "$prism_temp/node"
    tar -xzf "$prism_node_archive" -C "$prism_temp/node" </dev/null
    prism_extracted="$prism_temp/node/node-$prism_node_version-$prism_target"
    [ -f "$prism_extracted/bin/node" ] && [ ! -L "$prism_extracted/bin/node" ] || fail 'Node archive has no regular runtime executable'
    [ "$(sha256 "$prism_extracted/bin/node")" = "$prism_node_binary_sha" ] || fail 'extracted Node binary checksum mismatch; nothing was installed'
    mkdir "$prism_node_dir"
    mkdir "$prism_node_dir/bin"
    cp "$prism_extracted/bin/node" "$prism_node"
    cp "$prism_extracted/LICENSE" "$prism_node_dir/LICENSE"
    chmod 755 "$prism_node"
    printf '%s\n%s\n' "$prism_node_sha" "$(sha256 "$prism_node")" > "$prism_node_dir/.prism-runtime.sha256"
    rmdir "$prism_node_lock"; prism_node_lock=
}
main() {
    parse_options "$@"
    if [ "$prism_help" = 1 ]; then help; return; fi
    case "$(uname -s)" in Darwin) prism_os=darwin ;; Linux) prism_os=linux ;; *) fail 'supports macOS and Linux only' ;; esac
    case "$(uname -m)" in arm64|aarch64) prism_arch=arm64 ;; x86_64|amd64) prism_arch=x64 ;; *) fail 'supports x64 and arm64 only' ;; esac
    prism_target="$prism_os-$prism_arch"
    for prism_tool in curl tar awk mktemp; do need "$prism_tool"; done
    if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1 && ! command -v openssl >/dev/null 2>&1; then fail 'needs sha256sum, shasum or openssl'; fi
    if [ "$prism_os" = linux ] && command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | awk 'tolower($0) ~ /musl/ {found=1} END {exit !found}'; then fail 'official Node/Herdr binaries require glibc Linux; musl/Alpine is unsupported'; fi
    prism_temp=$(mktemp -d "${TMPDIR:-/tmp}/prism-install.XXXXXXXX")
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [ -n "$prism_node" ]; then
        prism_node_version=$("$prism_node" --version </dev/null 2>/dev/null) || fail 'cannot execute the specified Node runtime'
        compatible_node "$prism_node_version" || fail 'specified Node must be >=22.13.0'
    else
        prism_node=$(command -v node || true)
        prism_node_version=$([ -z "$prism_node" ] || "$prism_node" --version </dev/null 2>/dev/null || true)
        compatible_node "$prism_node_version" || install_node
    fi
    prism_node=$("$prism_node" -p 'process.execPath' </dev/null)
    # Only the archive downloaded below owns revision metadata. An explicitly
    # reviewed source directory must prove its own clean Git provenance.
    PRISM_INSTALL_REVISION=; export PRISM_INSTALL_REVISION
    if [ -z "$prism_source" ]; then
        prism_encoded_ref=$("$prism_node" -p 'encodeURIComponent(process.argv[1])' "$prism_ref" </dev/null)
        download "https://api.github.com/repos/alexiob/herdr-prism/commits/$prism_encoded_ref" "$prism_temp/commit.json"
        prism_revision=$("$prism_node" -e 'const j=JSON.parse(require("node:fs").readFileSync(process.argv[1])); if(!/^[a-f0-9]{40}$/.test(j.sha)) throw Error("Invalid GitHub revision"); console.log(j.sha)' "$prism_temp/commit.json" </dev/null)
        PRISM_INSTALL_REVISION=$prism_revision; export PRISM_INSTALL_REVISION
        say "preparing alexiob/herdr-prism at $prism_revision"
        download "https://codeload.github.com/alexiob/herdr-prism/tar.gz/$prism_revision" "$prism_temp/prism.tar.gz"
        prism_source="$prism_temp/source"; mkdir "$prism_source"
        tar -xzf "$prism_temp/prism.tar.gz" --strip-components=1 -C "$prism_source" </dev/null
    fi
    [ -f "$prism_source/scripts/bootstrap-unix.mjs" ] || fail 'source revision lacks the Unix bootstrap; select a newer revision'
    # Node resolves module filenames physically; use that same spelling on macOS
    # (/tmp and /var are symlinks) and with explicitly symlinked source trees.
    prism_source=$("$prism_node" -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$prism_source" </dev/null)
    "$prism_node" "$prism_source/scripts/bootstrap-unix.mjs" "$@" </dev/null
}

main "$@"
