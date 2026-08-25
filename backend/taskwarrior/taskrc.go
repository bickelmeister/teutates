package taskwarrior

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// maxIncludeDepth guards against rc files that include each other.
const maxIncludeDepth = 10

// origin records where a configured value came from and what it literally
// says, which may differ from the value Taskwarrior resolves at runtime.
type origin struct {
	source string
	value  string
}

// taskrcPath returns the rc file Taskwarrior would use: $TASKRC if set,
// otherwise ~/.taskrc.
func taskrcPath() (string, error) {
	if path := strings.TrimSpace(os.Getenv("TASKRC")); path != "" {
		return expandHome(path), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("taskwarrior: locating home directory: %w", err)
	}
	return filepath.Join(home, ".taskrc"), nil
}

// expandHome resolves a leading `~/` against the current user's home.
func expandHome(path string) string {
	if path != "~" && !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(path, "~"), "/"))
}

// parseTaskrc reads an rc file and every file it includes, returning the
// origin of each configured key. Later definitions win, matching
// Taskwarrior's own precedence. Includes that cannot be located are
// returned separately rather than failing the whole read.
func parseTaskrc(path string, searchDirs []string) (map[string]origin, []string, error) {
	origins := make(map[string]origin)
	visited := make(map[string]bool)
	var unresolved []string

	err := readRCFile(path, "taskrc", searchDirs, 0, origins, visited, &unresolved)
	return origins, unresolved, err
}

func readRCFile(path, source string, searchDirs []string, depth int, origins map[string]origin, visited map[string]bool, unresolved *[]string) error {
	if depth > maxIncludeDepth {
		return fmt.Errorf("taskwarrior: include depth exceeded at %s", path)
	}
	// A file included twice contributes nothing new and may be a cycle.
	if resolved, err := filepath.Abs(path); err == nil {
		if visited[resolved] {
			return nil
		}
		visited[resolved] = true
	}

	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("taskwarrior: reading %s: %w", path, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if target, ok := includeTarget(line); ok {
			included, found := resolveInclude(target, filepath.Dir(path), searchDirs)
			if !found {
				*unresolved = append(*unresolved, target)
				continue
			}
			// Values keep the name of the file that actually defines them.
			childSource := "include:" + filepath.Base(included)
			if err := readRCFile(included, childSource, searchDirs, depth+1, origins, visited, unresolved); err != nil {
				return err
			}
			continue
		}

		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		origins[key] = origin{source: source, value: strings.TrimSpace(value)}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("taskwarrior: reading %s: %w", path, err)
	}
	return nil
}

// includeTarget recognises Taskwarrior's `include <file>` directive, which
// is also accepted as `include=<file>`. Keys that merely start with the
// word, such as `includes.foo=1`, are not directives.
func includeTarget(line string) (string, bool) {
	rest, ok := strings.CutPrefix(line, "include")
	if !ok || rest == "" {
		return "", false
	}
	switch rest[0] {
	case ' ', '\t', '=':
	default:
		return "", false
	}
	rest = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(rest), "="))
	if rest == "" {
		return "", false
	}
	return rest, true
}

// resolveInclude locates an included file relative to the including file
// first, then in Taskwarrior's shipped rc directories.
func resolveInclude(target, baseDir string, searchDirs []string) (string, bool) {
	target = expandHome(os.ExpandEnv(target))

	candidates := []string{target}
	if !filepath.IsAbs(target) {
		candidates = []string{filepath.Join(baseDir, target)}
		for _, dir := range searchDirs {
			candidates = append(candidates, filepath.Join(dir, target))
		}
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}
	return "", false
}
