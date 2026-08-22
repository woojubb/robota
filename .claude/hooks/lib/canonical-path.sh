# shellcheck shell=bash
#
# INFRA-110 — where does this path actually LAND, with a stated domain.
#
# WHAT THIS REPLACES. `bulk-edit-guard.sh` climbed with `dirname` to the deepest existing directory,
# resolved that with `cd` + `pwd -P`, and re-attached the segments that did not exist yet. The
# function had no stated domain, so its correctness was defined by whichever input shapes a reviewer
# happened to try — and three review rounds each found a new one:
#
#   round 1  `-e "$FILE_PATH"` is false for the file being created
#   round 2  the parent may not exist either — add the ancestor climb
#   round 3  `CDPATH` fails open, `..` is not normalised, the leaf is not resolved
#
# Each hole is a one-line patch, and all three patched together is a hand-rolled `realpath` with four
# special cases and still no domain — the next class found by the next reviewer rather than by the
# code. So this is the ordinary algorithm instead, with the domain written down.
#
# MEASURED before replacing it, on a sandbox where `app/vendored -> ../node_modules/pkg` and
# `app/filelink.ts -> ../node_modules/pkg/src/index.ts`:
#
#   app/vendored/src/new.ts                      refused    correct
#   app/filelink.ts                              PERMITTED  the leaf was never resolved
#   app/nonexistent/../vendored/src/x.ts         PERMITTED  the `..` was re-attached verbatim
#   app/vendored/src/new.ts, CDPATH exported     PERMITTED  only for a RELATIVE path — see below
#
# The `CDPATH` row is narrower than the item that filed it claimed, and the correction is worth
# keeping: `cd` consults `CDPATH` only for a relative operand, so an absolute ancestor was never
# affected. A relative one was, and the hook receives whatever path the tool call carried.
#
# THE ALGORITHM. Segments are consumed left to right against an accumulator that is canonical at
# every step. A symlink is expanded by pushing its own segments back onto the pending list, so a
# target containing `..` or another link is resolved by the same loop. Because the accumulator is
# always physically canonical, `..` can be applied to it lexically — that is the invariant the whole
# thing rests on, and it is what a purely lexical normaliser gets wrong: `app/vendored/../x` is
# `node_modules/x`, not `app/x`.
#
# THE DOMAIN, stated rather than discovered:
#
#   * The input MUST be absolute. `canonical_path` refuses a relative one rather than resolving it
#     against whatever directory the hook happens to be running in, which is not the directory the
#     tool call meant. The caller makes it absolute against the payload's own `cwd`.
#   * A NON-EXISTENT tail is fine and is the normal case — a write creates a file that is not there
#     yet. Such segments cannot be symlinks, so they accumulate unresolved and that is correct.
#   * `~` is NOT expanded. The shell expands it before any tool sees it; a literal `~` reaching here
#     is a directory genuinely named `~`.
#   * A SYMLINK LOOP is refused (non-zero, no output), not silently truncated. A caller that treats
#     "no output" as "nothing found" would turn a loop into a permit.
#   * TOCTOU is out of scope: the answer is true when it is computed. A hook cannot hold the
#     filesystem still, and this one runs immediately before the write.
#   * `readlink` is used WITHOUT `-f`. The `-f` form is GNU-only and comes back silently unresolved
#     on macOS, which `shell-portability` refuses by name; plain `readlink` reads one link, which is
#     all this loop wants.

# TWO bounds, because they protect different things and one of them was measured wrong.
#
# `MAX_LINKS` is the real loop detector: how many SYMLINK EXPANSIONS may happen before the path is
# declared a loop. Linux's own limit is 40 and this is the same order, deliberately.
#
# `MAX_STEPS` bounds total segments, for a pathological input that is long rather than looping.
#
# The first cut had only the step bound, at 4096, and its own case exposed why that is not enough: a
# two-link loop consumed 4096 iterations of array manipulation before refusing, which took 12 SECONDS
# — on a hook that runs before every `Write` and `Edit`. Correct and unusable are not the same
# verdict, and a bound that only protects termination lets a loop become a stall.
CANONICAL_PATH_MAX_LINKS=64
CANONICAL_PATH_MAX_STEPS=4096

# Resolve an ABSOLUTE path to where it actually lands. Non-zero and no output on a relative input or
# a symlink loop; callers must treat that as a refusal, never as a clean path.
canonical_path() {
  local input="$1" out='' seg link
  local -a pending linkparts
  local steps=0 links=0

  [[ "$input" == /* ]] || return 1

  IFS='/' read -r -a pending <<< "$input"

  while ((${#pending[@]} > 0)); do
    if ((++steps > CANONICAL_PATH_MAX_STEPS)); then
      return 1
    fi

    seg="${pending[0]}"
    pending=("${pending[@]:1}")

    case "$seg" in
      '' | '.')
        continue
        ;;
      '..')
        # Safe lexically because `out` is canonical at every step: every symlink to its left has
        # already been expanded.
        out="${out%/*}"
        continue
        ;;
    esac

    out="$out/$seg"

    if [[ -L "$out" ]]; then
      if ((++links > CANONICAL_PATH_MAX_LINKS)); then
        return 1
      fi
      link=$(readlink -- "$out") || return 1
      if [[ "$link" == /* ]]; then
        out=''
      else
        # A relative target is resolved against the directory HOLDING the link.
        out="${out%/*}"
      fi
      IFS='/' read -r -a linkparts <<< "$link"
      pending=("${linkparts[@]}" "${pending[@]}")
    fi
  done

  printf '%s' "${out:-/}"
}

# The same answer for a path that may be relative, made absolute against an explicit base.
#
# The base is passed IN rather than read from `$PWD`, because a hook does not necessarily run in the
# directory the tool call was made from, and resolving against the wrong one is a wrong answer that
# looks like a right one.
canonical_path_from() {
  local base="$1" input="$2"
  [[ "$base" == /* ]] || return 1
  if [[ "$input" == /* ]]; then
    canonical_path "$input"
  else
    canonical_path "$base/$input"
  fi
}
