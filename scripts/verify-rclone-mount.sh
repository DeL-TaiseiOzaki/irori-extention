#!/usr/bin/env bash
# irori verify-rclone-mount help begin
#
# scripts/verify-rclone-mount.sh -- Verify the load-bearing assumptions behind the
# multi-drive contents/ design (see .claude/docs/plans/multi-drive-contents-2026-09.md
# and .claude/docs/research/drive-mount-and-team-cli-2026-09.md) on a real macOS machine.
#
# This script cannot run meaningfully on Linux without rclone/FUSE/a Google account; it
# is written to degrade to SKIP everywhere those are missing rather than fail or falsely
# pass. Read the companion procedure for full context and the manual (non-scriptable)
# checks: .claude/docs/research/rclone-verification-procedure.md
#
# Checks (numbered to match the procedure doc's "assumptions that actually need testing"):
#   1. rclone `backend -o config drives` emits a usable combine remote (My Drive + every
#      Shared Drive as siblings).
#   2. A mount/symlink placed INSIDE a real contents/ stays git-ignored; contents/ ITSELF
#      being a symlink does not (the documented trailing-slash trap). Synthetic, no rclone
#      or Drive account required.
#   3. Windows mklink /J vs mklink /D vs `rclone mount` onto a nonexistent subdirectory --
#      documentation only; this is a POSIX script and cannot run on Windows.
#   4. Local writes through the mount produce filesystem events (fswatch-based, opt-in).
#   5. Recursive-listing time / Drive rate-limit exposure, bounded by default.
#   6. macOS File Provider: does a metadata-only scan avoid pulling file bytes?
#   7. Obsidian's indexer over a mounted vault path -- manual only, throwaway vault only.
#   8. Does the extension see a mounted drive? Split into the two code paths that actually
#      exist: (a) a mount INSIDE the workspace (e.g. contents/drive), read by VS Code's own
#      vscode.workspace.findFiles() and governed by VS Code's search.followSymlinks setting;
#      (b) a mount registered as a layer's external root, read by this extension's own
#      walkDirectory() (src/walk.ts) and governed by irori.followSymlinks.
#
# SAFETY
#   - Read-only by default. The only exception is check 4, and only when --allow-write is
#     passed: it then creates one freshly, uniquely named directory (via mktemp -d, so it
#     can never reuse or follow a pre-existing entry, symlinked or not) under the mount you
#     point it at, writes one file inside it, then removes just that file and that directory.
#     No other check writes outside the scratch directory this script creates for itself.
#   - Never runs an unscoped recursive delete anywhere in this file. The only removal calls
#     are `rm -f` on a single named path and `rmdir` on a directory, which refuses to remove
#     anything non-empty -- cleanup of the one opt-in probe file/directory uses exactly those
#     two calls, nothing broader.
#   - Never touches credentials: never reads or prints rclone.conf, never runs
#     `rclone config create/update/password`, never prompts for a token or password.
#   - Never prints OAuth/refresh tokens or raw `rclone config show`/`config dump` output.
#     Any rclone output that could contain drive/team names (check 1) is written to a file
#     under this script's own scratch directory (chmod 600), never to stdout; the script
#     prints only counts and booleans, and tells you the file's path at the end so you can
#     review or discard it yourself -- it is not deleted automatically.
#   - Any filesystem path this script prints that could embed a Google account identifier
#     (a macOS CloudStorage folder is literally named GoogleDrive-<email>) is masked before
#     printing, whether that path was auto-detected or given via --mount-path /
#     --file-provider-path. Values you type after --drive-remote are echoed back verbatim,
#     the same way any CLI echoes its own flags -- that is not something the script
#     discovered about you, it is what you just typed.
#   - Every check either fails closed to SKIP (missing prerequisite, ambiguous tool output)
#     or requires positive, attributable evidence before reporting PASS -- see check 4 and
#     check 6 in particular, where a failed sub-command can no longer be silently counted as
#     a pass.
#   - Exits 1 if any check reports FAIL; exits 0 otherwise, including when every check is
#     SKIP (e.g. rclone is not installed).
#
# USAGE
#   ./scripts/verify-rclone-mount.sh [options]
#
# OPTIONS
#   --mount-path DIR          Directory an rclone mount or Drive-for-Desktop link already
#                              points at (you create/manage the mount yourself; this script
#                              never mounts or unmounts anything). Enables checks 4, 5, 8.
#   --drive-remote NAME       Base rclone remote name for check 1. Default: drive
#   --file-provider-path DIR  Path to a Google Drive for Desktop CloudStorage root for
#                              check 6. Default: auto-detect
#                              ~/Library/CloudStorage/GoogleDrive-*
#   --allow-write             Allow check 4 to write one throwaway probe file through the
#                              mount. Without this flag check 4 always SKIPs.
#   --deep                    Check 5 does a full recursive scan instead of the default
#                              depth-bounded one. This is the scenario most likely to trip
#                              Drive's rate limit -- do not run it repeatedly in a short
#                              window.
#   --scan-depth N             Depth for the bounded (non --deep) check 5 scan. Default: 2
#   --workspace-settings PATH Path to a workspace's .vscode/settings.json, read by checks 8a
#                              and 8b for the effective search.followSymlinks /
#                              irori.followSymlinks value. Default: .vscode/settings.json
#                              (relative to the current directory -- run this script from the
#                              workspace root you want to test, or pass this explicitly).
#   --only N                  Run only check N (1-7, 8, 8a, or 8b) instead of all of them.
#                              "8" runs both 8a and 8b.
#   -h, --help                Print this help and exit 0.
#
# ENVIRONMENT (used when the matching flag is not given)
#   MOUNT_PATH, RCLONE_DRIVE_REMOTE, FILE_PROVIDER_PATH, ALLOW_WRITE=1, DEEP_SCAN=1,
#   SCAN_DEPTH=N, ONLY_CHECK=N, WORKSPACE_SETTINGS=PATH
#
# irori verify-rclone-mount help end

set -u
set -o pipefail

# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

have_cmd() {
	command -v "$1" >/dev/null 2>&1
}

die() {
	printf 'ERROR: %s\n' "$1" >&2
	exit 2
}

pass() {
	printf 'PASS: %s\n' "$1"
	if [ -n "${2:-}" ]; then
		printf '      %s\n' "$2"
	fi
	PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
	printf 'FAIL: %s\n' "$1"
	if [ -n "${2:-}" ]; then
		printf '      %s\n' "$2"
	fi
	FAIL_COUNT=$((FAIL_COUNT + 1))
}

skip() {
	printf 'SKIP: %s\n' "$1"
	if [ -n "${2:-}" ]; then
		printf '      reason: %s\n' "$2"
	fi
	SKIP_COUNT=$((SKIP_COUNT + 1))
}

info() {
	printf 'INFO: %s\n' "$1"
}

# Mask any GoogleDrive-<email> segment anywhere in a path before it is printed, e.g.
# .../CloudStorage/GoogleDrive-alice@example.com/My Drive -> .../GoogleDrive-a***@example.com/My Drive
# Applied globally (not just to the basename) since the segment can appear mid-path.
mask_path_for_display() {
	printf '%s' "$1" | sed -E 's#GoogleDrive-([^/@])[^/@]*@([^/]*)#GoogleDrive-\1***@\2#g'
}

usage() {
	sed -n '/^# irori verify-rclone-mount help begin/,/^# irori verify-rclone-mount help end/p' "$0" |
		sed '1d;$d;s/^# \{0,1\}//'
}

# Look up a boolean key in a JSON(-ish) settings file (VS Code's settings.json is JSONC --
# comments and trailing commas are allowed -- so this is a best-effort reader, not a full
# parser). Uses jq when available for a real JSON parse; otherwise falls back to a plain-text
# search for `"key": true` / `"key": false`, which a comment or unusual formatting can fool.
# Sets (never local -- callers read this after calling): SETTINGS_LOOKUP_STATUS, one of
# "file-missing", "key-missing", "true", "false" -- the last two double as the found value.
read_settings_bool() {
	local file="$1"
	local key="$2"
	local val=""
	local pattern=""
	local line=""
	if [ ! -f "$file" ]; then
		SETTINGS_LOOKUP_STATUS="file-missing"
		return
	fi
	if have_cmd jq; then
		val=$(jq -r --arg k "$key" 'if has($k) then (.[$k] | tostring) else "" end' "$file" 2>/dev/null)
		case "$val" in
		true | false)
			SETTINGS_LOOKUP_STATUS="$val"
			return
			;;
		esac
	fi
	# -E (ERE) mode: grouping/alternation are plain ( ) | with NO backslash -- backslashing
	# them here would search for the literal characters "(true|false)" instead.
	pattern="\"$(printf '%s' "$key" | sed 's/\./\\./g')\"[[:space:]]*:[[:space:]]*(true|false)"
	line=$(grep -E "$pattern" "$file" 2>/dev/null | head -n1)
	if [ -z "$line" ]; then
		SETTINGS_LOOKUP_STATUS="key-missing"
		return
	fi
	case "$line" in
	*true*)
		SETTINGS_LOOKUP_STATUS="true"
		;;
	*)
		SETTINGS_LOOKUP_STATUS="false"
		;;
	esac
}

# --------------------------------------------------------------------------
# Argument parsing
# --------------------------------------------------------------------------

MOUNT_PATH="${MOUNT_PATH:-}"
DRIVE_REMOTE="${RCLONE_DRIVE_REMOTE:-drive}"
FILE_PROVIDER_PATH="${FILE_PROVIDER_PATH:-}"
ALLOW_WRITE="${ALLOW_WRITE:-0}"
DEEP_SCAN="${DEEP_SCAN:-0}"
SCAN_DEPTH="${SCAN_DEPTH:-2}"
ONLY_CHECK="${ONLY_CHECK:-}"
WORKSPACE_SETTINGS="${WORKSPACE_SETTINGS:-.vscode/settings.json}"

while [ $# -gt 0 ]; do
	case "$1" in
	--mount-path)
		[ $# -ge 2 ] || die "--mount-path requires a value"
		MOUNT_PATH="$2"
		shift 2
		;;
	--drive-remote)
		[ $# -ge 2 ] || die "--drive-remote requires a value"
		DRIVE_REMOTE="$2"
		shift 2
		;;
	--file-provider-path)
		[ $# -ge 2 ] || die "--file-provider-path requires a value"
		FILE_PROVIDER_PATH="$2"
		shift 2
		;;
	--allow-write)
		ALLOW_WRITE=1
		shift
		;;
	--deep)
		DEEP_SCAN=1
		shift
		;;
	--scan-depth)
		[ $# -ge 2 ] || die "--scan-depth requires a value"
		SCAN_DEPTH="$2"
		shift 2
		;;
	--workspace-settings)
		[ $# -ge 2 ] || die "--workspace-settings requires a value"
		WORKSPACE_SETTINGS="$2"
		shift 2
		;;
	--only)
		[ $# -ge 2 ] || die "--only requires a value (1-7, 8, 8a, or 8b)"
		ONLY_CHECK="$2"
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		die "unknown option: $1 (see --help)"
		;;
	esac
done

if [ -n "$ONLY_CHECK" ]; then
	case "$ONLY_CHECK" in
	1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 8a | 8b) ;;
	*) die "--only must be one of 1-7, 8, 8a, or 8b, got: ${ONLY_CHECK}" ;;
	esac
fi

case "$SCAN_DEPTH" in
'' | *[!0-9]*) die "--scan-depth must be a non-negative integer, got: ${SCAN_DEPTH}" ;;
*) ;;
esac

# --------------------------------------------------------------------------
# Scratch directory. Created once, never removed automatically (see the SAFETY section
# above): this script never does an unscoped recursive delete, and the file check 1 writes
# needs to still exist after the run so you can inspect it.
# --------------------------------------------------------------------------

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-rclone-mount.XXXXXX")" || die "could not create a scratch directory"
chmod 700 "$SCRATCH_DIR"

# Whether this `find` understands -maxdepth at all. `-maxdepth 0` is a trivial value every
# find that recognises the flag accepts; an unrecognised flag makes find exit non-zero.
# Checks 5 and 6 SKIP their depth-bounded step instead of guessing when this is false.
MAXDEPTH_OK=1
if ! find "$SCRATCH_DIR" -maxdepth 0 >/dev/null 2>&1; then
	MAXDEPTH_OK=0
fi

# --------------------------------------------------------------------------
# Check 1 -- rclone combine "drives" backend
# --------------------------------------------------------------------------

check1_combine_backend() {
	title="1/8 rclone 'backend -o config drives' emits a usable combine remote"
	if ! have_cmd rclone; then
		skip "$title" "rclone is not installed (macOS: brew install rclone)"
		return
	fi
	if ! rclone listremotes >"${SCRATCH_DIR}/listremotes.out" 2>"${SCRATCH_DIR}/listremotes.err"; then
		fail "$title" "'rclone listremotes' itself failed; see ${SCRATCH_DIR}/listremotes.err"
		return
	fi
	if ! grep -qxF "${DRIVE_REMOTE}:" "${SCRATCH_DIR}/listremotes.out"; then
		skip "$title" "no rclone remote named '${DRIVE_REMOTE}:' configured (run 'rclone config' to create your My Drive remote first, or pass --drive-remote <name>)"
		return
	fi
	out_file="${SCRATCH_DIR}/combine-config.out"
	err_file="${SCRATCH_DIR}/combine-config.err"
	touch "$out_file" "$err_file"
	chmod 600 "$out_file" "$err_file"
	if rclone backend -o config drives "${DRIVE_REMOTE}:" >"$out_file" 2>"$err_file"; then
		if grep -q '^type = combine' "$out_file" && grep -q '^upstreams' "$out_file"; then
			n_upstreams=$(grep '^upstreams' "$out_file" | grep -oE '"[^"]*"' | wc -l | tr -d ' ')
			pass "$title" "combine remote generated with ${n_upstreams} upstream entry/entries (My Drive + each Shared Drive you can see). This command does NOT write to rclone.conf -- you still have to paste the emitted [AllDrives] section in yourself before mounting it. Raw (unredacted drive/team names) output kept, not printed, at: ${out_file}"
		else
			fail "$title" "rclone exited 0 but the output did not contain a 'type = combine' / 'upstreams' section -- inspect ${out_file} yourself (it may contain drive/team names; do not paste it verbatim into chat or a ticket). If this genuinely fails, the case for introducing rclone at all evaporates: fall back to the already-verified per-drive symlink approach instead of a combine mount."
		fi
	else
		fail "$title" "'rclone backend -o config drives ${DRIVE_REMOTE}:' exited non-zero; see ${err_file}. If this fails on an account that does have Shared Drives, the single-mount design (recommendation #2 in the research doc) is not usable as documented -- fall back to one mount/symlink per drive."
	fi
}

# --------------------------------------------------------------------------
# Check 2 -- contents/ symlink trap, fully synthetic (no rclone / no Drive needed)
# --------------------------------------------------------------------------

check2_gitignore_trap() {
	title="2/8 mount/symlink INSIDE a real contents/ stays git-ignored; contents/ ITSELF as a symlink does not"
	if ! have_cmd git; then
		skip "$title" "git is not installed"
		return
	fi
	work="${SCRATCH_DIR}/gitignore-trap"
	if ! mkdir -p "$work"; then
		skip "$title" "could not create ${work}"
		return
	fi
	if ! (
		cd "$work" &&
			git init -q . &&
			printf 'contents/\ncontents-as-symlink/\n' >.gitignore &&
			mkdir -p contents &&
			ln -s /nonexistent-verify-rclone-mount-target contents/mounted-drive &&
			mkdir -p real-elsewhere &&
			ln -s real-elsewhere contents-as-symlink
	); then
		skip "$title" "could not build the synthetic git fixture under ${work} -- this is a local git/filesystem problem, not evidence about the design; inspect that directory directly"
		return
	fi
	case_a_ignored=1
	if (cd "$work" && git check-ignore -q contents/mounted-drive); then
		case_a_ignored=0
	fi
	case_b_ignored=1
	if (cd "$work" && git check-ignore -q contents-as-symlink); then
		case_b_ignored=0
	fi
	if [ "$case_a_ignored" -eq 0 ]; then
		if [ "$case_b_ignored" -ne 0 ]; then
			pass "$title" "confirmed on this git: a mount/symlink placed INSIDE a real contents/ is ignored (exit 0), and making contents/ ITSELF a symlink is NOT ignored by the trailing-slash rule (exit ${case_b_ignored}) -- never replace contents/ with a symlink."
		else
			pass "$title" "the design's actual shape (case A) is ignored, which is what matters operationally. Note: case B (contents/ itself as a symlink) was ALSO ignored on this git version, so the historical trap did not reproduce here -- do not take that as license to make contents/ a symlink; the design still forbids it on the git behavior documented for the versions in wide use."
		fi
	else
		fail "$title" "case A -- a mount/symlink inside a real, un-symlinked contents/ directory -- was NOT excluded by 'contents/' in .gitignore on this machine's git. This breaks the entire premise of the single contents/ ignore line; do not attach any mount until this is understood (check your git version and .gitignore for a conflicting rule)."
	fi
}

# --------------------------------------------------------------------------
# Check 3 -- Windows only, documentation
# --------------------------------------------------------------------------

check3_windows_note() {
	title="3/8 Windows: rclone mount onto a nonexistent contents\\ subdir vs mklink /J vs mklink /D"
	skip "$title" "this is a POSIX/macOS script and cannot run on Windows. See the 'Windows (manual)' section of the companion markdown for the exact PowerShell/cmd commands."
}

# --------------------------------------------------------------------------
# Check 4 -- file watching through the mount (opt-in write)
# --------------------------------------------------------------------------

check4_file_watch() {
	title="4/8 local writes through the mount produce a filesystem event"
	if [ -z "$MOUNT_PATH" ]; then
		skip "$title" "no --mount-path given (point it at a directory you have already mounted with rclone, or a Drive-for-Desktop path)"
		return
	fi
	if [ ! -d "$MOUNT_PATH" ]; then
		skip "$title" "'$(mask_path_for_display "$MOUNT_PATH")' does not exist or is not a directory"
		return
	fi
	if ! have_cmd fswatch; then
		skip "$title" "fswatch is not installed (macOS: brew install fswatch). Manual fallback: open the mount in Finder/VS Code, edit a file through a second terminal, and watch whether the UI updates on its own."
		return
	fi
	if [ "$ALLOW_WRITE" != "1" ]; then
		skip "$title" "pass --allow-write to let this check create and remove one throwaway file through the mount (needed to observe a write event at all)"
		return
	fi

	# A uniquely, randomly named directory (mktemp -d) rather than a fixed name: this
	# cannot reuse or follow a pre-existing entry -- symlinked or not -- because there is
	# no fixed name for anything to have pre-staged.
	probe_dir=$(mktemp -d "${MOUNT_PATH%/}/.verify-rclone-mount-probe.XXXXXX" 2>"${SCRATCH_DIR}/probe-mkdir.err")
	if [ -z "$probe_dir" ] || [ ! -d "$probe_dir" ]; then
		fail "$title" "could not create a fresh probe directory inside the mount (is it writable?); see ${SCRATCH_DIR}/probe-mkdir.err"
		return
	fi

	probe_file="${probe_dir}/probe.txt"
	fswatch_out="${SCRATCH_DIR}/fswatch.out"
	fswatch_err="${SCRATCH_DIR}/fswatch.err"
	: >"$fswatch_out"
	fswatch -1 "$probe_dir" >"$fswatch_out" 2>"$fswatch_err" &
	fswatch_pid=$!
	sleep 1 # let fswatch attach before we write

	write_ok=1
	if ! printf 'irori verify probe %s\n' "$(date -u +%FT%TZ)" >"$probe_file" 2>"${SCRATCH_DIR}/probe-write.err"; then
		write_ok=0
	fi

	limit=15
	waited=0
	while kill -0 "$fswatch_pid" 2>/dev/null && [ "$waited" -lt "$limit" ]; do
		sleep 1
		waited=$((waited + 1))
	done
	fswatch_running=1
	if ! kill -0 "$fswatch_pid" 2>/dev/null; then
		fswatch_running=0
	fi
	if [ "$fswatch_running" -eq 1 ]; then
		kill "$fswatch_pid" 2>/dev/null
	fi
	wait "$fswatch_pid" 2>/dev/null
	fswatch_status=$?

	# Cleanup happens once, here, regardless of which branch below reports the result.
	rm -f "$probe_file" 2>/dev/null
	rmdir "$probe_dir" 2>/dev/null || true

	if [ "$write_ok" -eq 0 ]; then
		fail "$title" "writing the probe file through the mount failed; see ${SCRATCH_DIR}/probe-write.err -- is the mount actually writable? (--vfs-cache-mode off rejects some write patterns)"
		return
	fi
	if [ "$fswatch_running" -eq 1 ]; then
		fail "$title" "no filesystem event observed within ${limit}s of a local write through the mount. This matches the design's own assumption ('do not rely on a watcher under contents/') -- it is not a surprise, but it does confirm VS Code / Obsidian must be told to rescan explicitly rather than relying on their file watcher."
		return
	fi
	if [ "$fswatch_status" -ne 0 ]; then
		skip "$title" "fswatch exited with status ${fswatch_status} before reporting an event; see ${fswatch_err} -- this is a tooling problem, not evidence about the mount"
		return
	fi
	if ! grep -qF "$probe_file" "$fswatch_out" 2>/dev/null && ! grep -qF "$(basename "$probe_dir")" "$fswatch_out" 2>/dev/null; then
		skip "$title" "fswatch reported an event but its output did not reference the probe file/directory this check wrote -- inconclusive; see ${fswatch_out}"
		return
	fi
	pass "$title" "a filesystem event referencing the probe write was observed after roughly ${waited}s. This is a good sign for fswatch specifically, but it does not by itself prove VS Code's or Obsidian's own watcher behaves the same way over this mount type -- treat an explicit rescan as required regardless."
}

# --------------------------------------------------------------------------
# Check 5 -- recursive listing time / rate-limit exposure (read-only)
# --------------------------------------------------------------------------

check5_scan_cost() {
	title="5/8 recursive listing time and Drive rate-limit exposure"
	if [ -z "$MOUNT_PATH" ]; then
		skip "$title" "no --mount-path given"
		return
	fi
	if [ ! -d "$MOUNT_PATH" ]; then
		skip "$title" "'$(mask_path_for_display "$MOUNT_PATH")' does not exist or is not a directory"
		return
	fi
	if [ "$DEEP_SCAN" != "1" ] && [ "$MAXDEPTH_OK" -eq 0 ]; then
		skip "$title" "this 'find' does not appear to support -maxdepth, and a full recursive scan needs the explicit --deep flag (see the warning below) -- cannot run the bounded scan safely"
		return
	fi
	err_file="${SCRATCH_DIR}/find.err"
	start_ts=$(date +%s)
	if [ "$DEEP_SCAN" = "1" ]; then
		note="full recursive scan (--deep): this is the scenario most likely to trip Drive's documented ~2 files/second rate limit -- do not repeat it in a short window"
		file_count=$(find "$MOUNT_PATH" -type f 2>"$err_file" | wc -l | tr -d ' ')
	else
		note="bounded to depth ${SCAN_DEPTH} (pass --deep for a full recursive scan, at your own risk of rate limiting)"
		file_count=$(find "$MOUNT_PATH" -maxdepth "$SCAN_DEPTH" -type f 2>"$err_file" | wc -l | tr -d ' ')
	fi
	scan_status=$?
	end_ts=$(date +%s)
	elapsed=$((end_ts - start_ts))
	if [ "$scan_status" -ne 0 ] || [ -s "$err_file" ]; then
		fail "$title" "the listing pipeline reported an error (exit ${scan_status}); see ${err_file}. Treat this as an unreliable/unreadable mount, not a clean scan -- an unbound or errored mount must never be reported as scanned cleanly."
		return
	fi
	if grep -qi 'rateLimitExceeded\|userRateLimitExceeded\|too many requests' "$err_file" 2>/dev/null; then
		fail "$title" "a Drive rate-limit error appeared during a read-only ${note}. Any full FR-7 rescan must be throttled or backed off, not run freely on every save."
		return
	fi
	rate_note=""
	if [ "$elapsed" -gt 0 ]; then
		rate_note=" (~$((file_count / elapsed)) files/s)"
	fi
	pass "$title" "${file_count} file(s) listed in ${elapsed}s${rate_note}, ${note}. Compare against the documented ~2 files/s Drive rate limit if this ever approaches it, and prefer batched/lazy listing over a naive full walk for large trees."
}

# --------------------------------------------------------------------------
# Check 6 -- macOS File Provider materialization (read-only: readdir + stat only)
# --------------------------------------------------------------------------

check6_file_provider() {
	title="6/8 macOS File Provider: does a metadata-only scan pull file bytes?"
	if [ "$(uname -s)" != "Darwin" ]; then
		skip "$title" "not macOS (uname -s = $(uname -s)); this check is specific to Google Drive for Desktop's File Provider integration"
		return
	fi
	home_dir="${HOME:-}"
	fp_path="$FILE_PROVIDER_PATH"
	if [ -z "$fp_path" ]; then
		if [ -z "$home_dir" ]; then
			skip "$title" "HOME is not set and no --file-provider-path was given -- cannot auto-detect ~/Library/CloudStorage"
			return
		fi
		# Depth-1 glob instead of `find -maxdepth 1`: simpler, and avoids depending on
		# -maxdepth for this particular lookup. With `set -u` and no match, the loop body
		# still runs once with the literal unexpanded pattern, and the `-d` test below
		# correctly rejects it (see the check just after this loop).
		for candidate in "${home_dir}/Library/CloudStorage/"GoogleDrive-*; do
			if [ -d "$candidate" ]; then
				fp_path="$candidate"
				break
			fi
		done
	fi
	if [ -z "$fp_path" ] || [ ! -d "$fp_path" ]; then
		skip "$title" "no ~/Library/CloudStorage/GoogleDrive-* found -- install and sign in to Google Drive for Desktop, or pass --file-provider-path <dir>"
		return
	fi
	redacted="$(mask_path_for_display "$fp_path")"
	sample_dir="${fp_path%/}/My Drive"
	if [ ! -d "$sample_dir" ]; then
		skip "$title" "'${redacted}/My Drive' not found -- pass --file-provider-path at a populated Drive root"
		return
	fi
	if [ "$MAXDEPTH_OK" -eq 0 ]; then
		skip "$title" "this 'find' does not appear to support -maxdepth, needed to bound the sample depth under '${redacted}'"
		return
	fi
	sample_file="${SCRATCH_DIR}/file-provider-sample.txt"
	find "$sample_dir" -maxdepth 3 -type f 2>/dev/null | head -n 20 >"$sample_file"
	total=0
	valid=0
	materialized=0
	while IFS= read -r f; do
		[ -z "$f" ] && continue
		total=$((total + 1))
		logical=$(stat -f%z "$f" 2>/dev/null) || continue
		blocks=$(stat -f%b "$f" 2>/dev/null) || continue
		valid=$((valid + 1))
		physical=$((blocks * 512))
		if [ "$logical" -gt 0 ] && [ "$physical" -ge "$logical" ]; then
			materialized=$((materialized + 1))
		fi
	done <"$sample_file"
	if [ "$valid" -eq 0 ]; then
		skip "$title" "no file under '${redacted}/My Drive' could be stat'd successfully (found ${total}); nothing to report"
		return
	fi
	if [ "$materialized" -lt "$valid" ]; then
		pass "$title" "sampled ${valid} file(s) successfully via readdir+stat only (no file content was opened), out of ${total} listed: $((valid - materialized)) still look like cloud-only placeholders (on-disk blocks smaller than the reported size) after this scan touched them. A metadata-only scan (like the one this extension's rescan does) does not by itself force materialization -- opening file *contents* is what does."
	else
		skip "$title" "all ${valid} successfully-sampled files already looked fully materialized before this scan ran, so nothing was observed either way. Try again against a larger or less-recently-opened tree, or right after using Drive for Desktop's 'Free up space' action, to get a file that is genuinely still cloud-only."
	fi
}

# --------------------------------------------------------------------------
# Check 7 -- Obsidian, manual only
# --------------------------------------------------------------------------

check7_obsidian_note() {
	title="7/8 Obsidian: does its indexer descend into a mount placed inside the vault?"
	note="MANUAL ONLY -- never test this against your real vault. Duplicate a throwaway vault (or start a brand-new empty one) first. See the 'Obsidian (manual)' section of the companion markdown for exact steps and Obsidian's own symlink warning."
	if [ -d "/Applications/Obsidian.app" ]; then
		skip "$title" "$note (Obsidian.app is present, but this script never launches it)"
	else
		skip "$title" "$note (Obsidian.app not found in /Applications -- irrelevant either way; this check is manual regardless)"
	fi
}

# --------------------------------------------------------------------------
# Check 8a -- a mount INSIDE the workspace (e.g. contents/drive), read by VS Code's own
# vscode.workspace.findFiles(). Governed by VS Code's OWN search.followSymlinks setting, not
# by anything this extension controls. Confirmed against the actual VS Code 1.136.1 binary
# this repo's own test suite downloads (.vscode-test/): search.followSymlinks is a real,
# registered, boolean configuration key, default true (see the procedure doc for exactly what
# was checked and where). What is NOT independently confirmed from a primary source is that
# vscode.workspace.findFiles specifically consults this setting rather than only the Search UI
# panel -- both are documented to share VS Code's underlying search engine, which is why this
# check still treats it as authoritative, but say so plainly rather than overclaiming.
# --------------------------------------------------------------------------

check8a_workspace_mount() {
	title="8a/8 mount INSIDE the workspace, read by vscode.workspace.findFiles()"
	if [ -z "$MOUNT_PATH" ]; then
		skip "$title" "no --mount-path given"
		return
	fi
	if [ ! -e "$MOUNT_PATH" ] && [ ! -L "$MOUNT_PATH" ]; then
		skip "$title" "'$(mask_path_for_display "$MOUNT_PATH")' does not exist"
		return
	fi
	display_path="$(mask_path_for_display "$MOUNT_PATH")"

	read_settings_bool "$WORKSPACE_SETTINGS" "search.followSymlinks"
	case "$SETTINGS_LOOKUP_STATUS" in
	true | false)
		setting_value="$SETTINGS_LOOKUP_STATUS"
		setting_source="explicitly set in ${WORKSPACE_SETTINGS}"
		;;
	*)
		setting_value="true"
		setting_source="not set in ${WORKSPACE_SETTINGS} (file missing or key absent) -- VS Code's own registered default, true, applies"
		;;
	esac

	if [ ! -L "$MOUNT_PATH" ]; then
		pass "$title" "'${display_path}' is a real directory entry (an rclone-style mount), not a symlink -- VS Code's file search sees real directories regardless of search.followSymlinks, so this path is unaffected by that setting either way."
		return
	fi
	if [ "$setting_value" = "true" ]; then
		pass "$title" "'${display_path}' is a symlink; search.followSymlinks is effectively true (${setting_source}). VS Code's file search should therefore descend into it. This verdict is derived from VS Code's own configuration schema, not executed here -- confirm by actually opening the workspace and checking whether files under the mount appear in the Explorer or a workspace search."
	else
		fail "$title" "'${display_path}' is a symlink; search.followSymlinks is effectively false (${setting_source}). VS Code's file search will not descend into it -- nothing under this mount will appear in the workspace until that setting is turned back on."
	fi
}

# --------------------------------------------------------------------------
# Check 8b -- a mount registered as a layer's external root, read by this extension's own
# walkDirectory() (src/walk.ts), governed by irori.followSymlinks (this extension's own
# setting; default false, confirmed directly from its contribution point in package.json).
# --------------------------------------------------------------------------

check8b_roots_mount() {
	title="8b/8 mount under a layer's roots, read by walkDirectory()"
	if [ -z "$MOUNT_PATH" ]; then
		skip "$title" "no --mount-path given"
		return
	fi
	if [ ! -e "$MOUNT_PATH" ] && [ ! -L "$MOUNT_PATH" ]; then
		skip "$title" "'$(mask_path_for_display "$MOUNT_PATH")' does not exist"
		return
	fi
	display_path="$(mask_path_for_display "$MOUNT_PATH")"

	read_settings_bool "$WORKSPACE_SETTINGS" "irori.followSymlinks"
	case "$SETTINGS_LOOKUP_STATUS" in
	true | false)
		setting_value="$SETTINGS_LOOKUP_STATUS"
		setting_source="explicitly set in ${WORKSPACE_SETTINGS}"
		;;
	*)
		setting_value="false"
		setting_source="not set in ${WORKSPACE_SETTINGS} (file missing or key absent) -- the extension's shipped default, false, applies"
		;;
	esac

	if [ -L "$MOUNT_PATH" ]; then
		if [ "$setting_value" = "true" ]; then
			pass "$title" "'${display_path}' is a symlink; irori.followSymlinks is effectively true (${setting_source}). As of this writing, walkDirectory() follows a symlinked directory when this is on (with cycle/depth/entry-count limits) -- search src/walk.ts and src/workspaceIndex.ts for 'followSymlinks' to confirm the current behaviour before trusting this line."
		else
			fail "$title" "'${display_path}' is a symlink; irori.followSymlinks is effectively false (${setting_source}). As of this writing, walkDirectory() skips a symlinked directory entirely when this is off, and the extension surfaces a one-time warning naming how many were skipped -- search src/walk.ts and src/workspaceIndex.ts for 'followSymlinks' to confirm the current behaviour. Set irori.followSymlinks to true in ${WORKSPACE_SETTINGS} to make this mount visible as a layer root."
		fi
	elif [ -d "$MOUNT_PATH" ]; then
		pass "$title" "'${display_path}' is a real directory entry, not a symlink, so walkDirectory() traverses it regardless of irori.followSymlinks -- this is what an rclone FUSE mount point looks like, as opposed to a plain 'ln -s' link."
	else
		fail "$title" "'${display_path}' exists but is neither a directory nor a symlink -- investigate what it actually is before relying on it."
	fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

run_check() {
	n="$1"
	fn="$2"
	if [ -z "$ONLY_CHECK" ] || [ "$ONLY_CHECK" = "$n" ]; then
		"$fn"
		return
	fi
	# "--only 8" without a letter means "both 8a and 8b".
	case "$n" in
	8a | 8b)
		if [ "$ONLY_CHECK" = "8" ]; then
			"$fn"
		fi
		;;
	esac
}

main() {
	echo "== verify-rclone-mount: environment =="
	info "OS: $(uname -s) $(uname -r)"
	info "bash: ${BASH_VERSION:-unknown}"
	if have_cmd rclone; then
		info "rclone: $(rclone version 2>/dev/null | head -n1)"
	else
		info "rclone: not installed"
	fi
	if have_cmd fswatch; then
		info "fswatch: present"
	else
		info "fswatch: not installed"
	fi
	if have_cmd jq; then
		info "jq: present"
	else
		info "jq: not installed (checks 8a/8b fall back to a plain-text settings.json search)"
	fi
	if [ "$MAXDEPTH_OK" -eq 0 ]; then
		info "find: does not support -maxdepth (checks 5/6 bounded-depth steps will SKIP)"
	fi
	if [ -n "$MOUNT_PATH" ]; then
		info "mount path under test: $(mask_path_for_display "$MOUNT_PATH")"
	else
		info "mount path under test: <none given>"
	fi
	info "workspace settings file for checks 8a/8b: ${WORKSPACE_SETTINGS}"
	echo

	echo "== checks =="
	run_check 1 check1_combine_backend
	run_check 2 check2_gitignore_trap
	run_check 3 check3_windows_note
	run_check 4 check4_file_watch
	run_check 5 check5_scan_cost
	run_check 6 check6_file_provider
	run_check 7 check7_obsidian_note
	run_check 8a check8a_workspace_mount
	run_check 8b check8b_roots_mount

	echo
	echo "== summary =="
	printf 'PASS: %d  FAIL: %d  SKIP: %d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
	printf 'Scratch data (may contain drive/remote names, never credentials) kept at: %s\n' "$SCRATCH_DIR"
	printf 'Review it yourself, then remove it when done, e.g.: rm -r "%s"\n' "$SCRATCH_DIR"

	if [ "$FAIL_COUNT" -gt 0 ]; then
		exit 1
	fi
	exit 0
}

main "$@"
