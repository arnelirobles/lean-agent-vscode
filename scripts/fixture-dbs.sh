#!/usr/bin/env bash
# Build brain.db and tests.db with the real brain and test-phase CLIs.
# Usage: scripts/fixture-dbs.sh <brain-dir> <tools-dir> <out-dir>
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <brain-dir> <tools-dir> <out-dir>" >&2
  exit 2
fi

brain_dir=$1
tools_dir=$2
out_dir=$3

# Both CLIs default --session from these.
unset LEAN_SESSION_ID LEAN_SESSION_CWD

mkdir -p "$out_dir"
out_dir=$(cd "$out_dir" && pwd)
rm -f "$out_dir/brain.db" "$out_dir/tests.db"
rm -rf "$out_dir/repo"
mkdir -p "$out_dir/repo"

export LEAN_BRAIN_DB="$out_dir/brain.db"
export LEAN_TESTS_DB="$out_dir/tests.db"

brain="$brain_dir/tools/brain"
test_phase="$tools_dir/tools/test-phase"

"$brain" add --project demo --kind test-fail --ref Demo.Tests.Fails --cycle c1 --title "demo failing test" --severity high
"$brain" add --project demo --kind flaky --ref Demo.Tests.Flaky --cycle c1 --title "demo flaky test" --severity low
"$brain" activity add --source ci --action fixture --project demo

"$test_phase" queue add --cycle c1 --project demo --tier full "$out_dir/repo" Demo.Tests
"$test_phase" run-add --cycle c1 --project demo --test-project Demo.Tests --tier full --passed 3 --failed 1

test -s "$out_dir/brain.db"
test -s "$out_dir/tests.db"
echo "wrote $out_dir/brain.db and $out_dir/tests.db"
