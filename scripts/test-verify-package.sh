#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
verify_script=$repo_dir/scripts/verify-package.sh
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

create_fixture() {
	fixture=$1
	mkdir -p "$fixture/server" "$fixture/ui"
	cat > "$fixture/manifest.yaml" <<'EOF'
api_version: 1
runtime:
  type: binary
  executables:
    linux-amd64: "server/plugin-linux-amd64"
    linux-arm64: "server/plugin-linux-arm64"
    darwin-amd64: "server/plugin-darwin-amd64"
    darwin-arm64: "server/plugin-darwin-arm64"
    windows-amd64: "server/plugin-windows-amd64.exe"
EOF
	printf 'export default {}\n' > "$fixture/ui/bundle.js"
	for executable in \
		plugin-linux-amd64 plugin-linux-arm64 \
		plugin-darwin-amd64 plugin-darwin-arm64 \
		plugin-windows-amd64.exe; do
		printf 'fixture binary: %s\n' "$executable" > "$fixture/server/$executable"
	done
	write_checksums "$fixture"
}

write_checksums() {
	fixture=$1
	(
		cd "$fixture"
		find . -type f ! -name checksums.txt -print | sed 's#^\./##' | LC_ALL=C sort |
		while IFS= read -r path; do
			if command -v sha256sum >/dev/null 2>&1; then
				sha256sum "$path"
			else
				shasum -a 256 "$path"
			fi
		done
	) > "$fixture/checksums.txt"
}

copy_fixture() {
	name=$1
	fixture=$test_dir/$name
	mkdir -p "$fixture"
	cp -R "$test_dir/valid/." "$fixture/"
}

expect_failure() {
	name=$1
	fixture=$2
	mode=${3-full}
	platform=${4-}
	if [ "$mode" = host ]; then
		if sh "$verify_script" "$fixture" host "$platform" >/dev/null 2>&1; then
			printf 'expected package verification to reject %s\n' "$name" >&2
			exit 1
		fi
	elif sh "$verify_script" "$fixture" full >/dev/null 2>&1; then
		printf 'expected package verification to reject %s\n' "$name" >&2
		exit 1
	fi
}

mkdir -p "$test_dir/valid"
create_fixture "$test_dir/valid"
sh "$verify_script" "$test_dir/valid" full >/dev/null
host_platform=$(go env GOOS)-$(go env GOARCH)
copy_fixture host-valid
host_fixture=$test_dir/host-valid
host_executable=$(awk -v platform="$host_platform" '$0 ~ "    " platform ":" { gsub(/"/, "", $2); print $2 }' "$host_fixture/manifest.yaml")
[ -n "$host_executable" ] || { printf 'fixture does not declare host platform %s\n' "$host_platform" >&2; exit 1; }
for executable in "$host_fixture"/server/*; do
	[ "$executable" = "$host_fixture/$host_executable" ] || rm "$executable"
done
write_checksums "$host_fixture"
sh "$verify_script" "$host_fixture" host "$host_platform" >/dev/null

for required in manifest.yaml ui/bundle.js \
	server/plugin-linux-amd64 server/plugin-linux-arm64 \
	server/plugin-darwin-amd64 server/plugin-darwin-arm64 \
	server/plugin-windows-amd64.exe; do
	copy_fixture "missing-${required##*/}"
	fixture=$test_dir/missing-${required##*/}
	rm "$fixture/$required"
	write_checksums "$fixture"
	expect_failure "missing $required" "$fixture"
done

copy_fixture missing-checksums
rm "$test_dir/missing-checksums/checksums.txt"
expect_failure 'missing checksums.txt' "$test_dir/missing-checksums"

copy_fixture corrupt-ui
printf '// changed after checksum generation\n' >> "$test_dir/corrupt-ui/ui/bundle.js"
expect_failure 'corrupt UI contents' "$test_dir/corrupt-ui"

copy_fixture incomplete-checksums
sed '/  ui\/bundle.js$/d' "$test_dir/incomplete-checksums/checksums.txt" > "$test_dir/incomplete-checksums/checksums.next"
mv "$test_dir/incomplete-checksums/checksums.next" "$test_dir/incomplete-checksums/checksums.txt"
expect_failure 'an omitted checksum entry' "$test_dir/incomplete-checksums"

for forbidden in recipes/source-control/README.md package.json package-lock.json tsconfig.recipes.json scripts/verify-package.sh; do
	copy_fixture "forbidden-${forbidden##*/}"
	fixture=$test_dir/forbidden-${forbidden##*/}
	mkdir -p "$fixture/$(dirname "$forbidden")"
	printf 'must stay outside packages\n' > "$fixture/$forbidden"
	write_checksums "$fixture"
	expect_failure "checksummed forbidden path $forbidden" "$fixture"
done

copy_fixture unexpected-file
printf 'unexpected\n' > "$test_dir/unexpected-file/extra.txt"
write_checksums "$test_dir/unexpected-file"
expect_failure 'a checksummed unexpected file' "$test_dir/unexpected-file"

copy_fixture wrong-host-platform
expect_failure 'a host platform missing from the manifest' "$test_dir/wrong-host-platform" host freebsd-amd64

printf 'package verifier negative tests passed\n'
