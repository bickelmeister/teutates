// Package taskwarrior reads configuration from a local Taskwarrior
// installation. Taskwarrior 3.x keeps its task data in a TaskChampion
// SQLite database, so configuration is obtained by invoking the `task`
// binary rather than by parsing data files directly.
package taskwarrior

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// commandTimeout bounds every invocation of the `task` binary so a hung
// or interactive Taskwarrior cannot stall an HTTP request.
const commandTimeout = 3 * time.Second

// ErrTaskNotFound reports that the `task` binary is not on PATH.
var ErrTaskNotFound = errors.New("taskwarrior: `task` binary not found on PATH")

// Setting is a single effective configuration entry.
type Setting struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	// ConfiguredValue is set only when the value written in the rc files
	// differs from the value Taskwarrior actually reports. This happens
	// for TTY-dependent keys such as `color`, which resolves to `off`
	// when Taskwarrior runs without a terminal.
	ConfiguredValue string `json:"configuredValue,omitempty"`
	Group           string `json:"group"`
	// Source is "default" for built-in values, "taskrc" for values set in
	// the main rc file, or "include:<name>" for values from an included file.
	Source     string `json:"source"`
	IsOverride bool   `json:"isOverride"`
}

// Group is a namespace of settings, derived from the key prefix.
type Group struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Config is the payload served by the settings endpoint.
type Config struct {
	TaskVersion string    `json:"taskVersion"`
	TaskrcPath  string    `json:"taskrcPath"`
	Groups      []Group   `json:"groups"`
	Settings    []Setting `json:"settings"`
	// UnresolvedIncludes lists `include` directives whose target file could
	// not be located. Values from those files still appear, but as defaults.
	UnresolvedIncludes []string `json:"unresolvedIncludes,omitempty"`
}

// generalGroup collects keys that carry no dotted prefix.
const generalGroup = "general"

// runTask executes the `task` binary with fixed arguments. Arguments are
// never passed through a shell.
func runTask(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "task", args...)
	// Taskwarrior prompts on some code paths; an empty stdin makes it fail
	// fast instead of blocking until the timeout.
	cmd.Stdin = strings.NewReader("")

	var stderr strings.Builder
	cmd.Stderr = &stderr

	out, err := cmd.Output()
	if err != nil {
		var execErr *exec.Error
		if errors.As(err, &execErr) {
			return "", ErrTaskNotFound
		}
		if ctx.Err() != nil {
			return "", fmt.Errorf("taskwarrior: `task %s` timed out after %s", strings.Join(args, " "), commandTimeout)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("taskwarrior: `task %s` failed: %s", strings.Join(args, " "), msg)
	}
	return string(out), nil
}

// parseShow reads the `key=value` lines emitted by `task _show`.
func parseShow(r io.Reader) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(r)
	// Report definitions and UDA labels can be long; the default 64KiB
	// token limit is generous but made explicit here.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		key, value, found := strings.Cut(line, "=")
		if !found {
			// `_show` emits nothing but key=value pairs; anything else is
			// skipped rather than treated as a fatal error.
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		values[key] = strings.TrimSpace(value)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("taskwarrior: reading config output: %w", err)
	}
	return values, nil
}

// groupOf derives a settings group from a configuration key.
func groupOf(key string) string {
	prefix, _, found := strings.Cut(key, ".")
	if !found || prefix == "" {
		return generalGroup
	}
	return prefix
}

// build merges the effective configuration with the origins parsed from the
// rc files into the payload served to the UI.
func build(effective map[string]string, origins map[string]origin, taskrcPath, version string, unresolved []string) *Config {
	settings := make([]Setting, 0, len(effective))
	counts := make(map[string]int)

	for key, value := range effective {
		group := groupOf(key)
		counts[group]++

		setting := Setting{
			Key:    key,
			Value:  value,
			Group:  group,
			Source: "default",
		}
		if o, ok := origins[key]; ok {
			setting.Source = o.source
			setting.IsOverride = true
			if o.value != value {
				setting.ConfiguredValue = o.value
			}
		}
		settings = append(settings, setting)
	}

	sort.Slice(settings, func(i, j int) bool {
		if settings[i].Group != settings[j].Group {
			return groupLess(settings[i].Group, settings[j].Group)
		}
		return settings[i].Key < settings[j].Key
	})

	groups := make([]Group, 0, len(counts))
	for name, count := range counts {
		groups = append(groups, Group{Name: name, Count: count})
	}
	sort.Slice(groups, func(i, j int) bool { return groupLess(groups[i].Name, groups[j].Name) })

	return &Config{
		TaskVersion:        version,
		TaskrcPath:         taskrcPath,
		Groups:             groups,
		Settings:           settings,
		UnresolvedIncludes: unresolved,
	}
}

// groupLess orders groups alphabetically but keeps `general` first, since
// those are the keys a user is most likely looking for.
func groupLess(a, b string) bool {
	if a == generalGroup {
		return b != generalGroup
	}
	if b == generalGroup {
		return false
	}
	return a < b
}

// parseVersion extracts the version from `task --version` output.
func parseVersion(out string) string {
	return strings.TrimSpace(strings.SplitN(strings.TrimSpace(out), "\n", 2)[0])
}

// themeDirs returns directories Taskwarrior searches for included rc
// fragments, derived from the location of the `task` binary
// (e.g. /opt/homebrew/bin/task -> /opt/homebrew/share/doc/task/rc).
func themeDirs() []string {
	path, err := exec.LookPath("task")
	if err != nil {
		return nil
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	prefix := filepath.Dir(filepath.Dir(path))
	return []string{filepath.Join(prefix, "share", "doc", "task", "rc")}
}
