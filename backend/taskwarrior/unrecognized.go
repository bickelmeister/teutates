package taskwarrior

import (
	"strings"
)

// unrecognizedMarker introduces the block `task show` prints for rc entries
// Taskwarrior does not know. There is no machine-readable equivalent, so
// this footnote is the only source for it.
const unrecognizedMarker = "unrecognized variables:"

// parseUnrecognized reads the trailing block of `task show`:
//
//	Your .taskrc file contains these unrecognized variables:
//	  sort
//
// An absent block simply means every configured key is known.
func parseUnrecognized(output string) []string {
	lines := strings.Split(output, "\n")

	start := -1
	for i, line := range lines {
		if strings.Contains(line, unrecognizedMarker) {
			start = i + 1
			break
		}
	}
	if start == -1 {
		return nil
	}

	var keys []string
	for _, line := range lines[start:] {
		// The block is indented and ends at the first blank line.
		if strings.TrimSpace(line) == "" {
			break
		}
		if !strings.HasPrefix(line, " ") {
			break
		}
		keys = append(keys, strings.TrimSpace(line))
	}
	return keys
}
