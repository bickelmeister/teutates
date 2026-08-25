package taskwarrior

import (
	"path/filepath"
	"testing"
)

func TestParseTaskrcResolvesIncludesAndOrigins(t *testing.T) {
	origins, unresolved, err := parseTaskrc(filepath.Join("testdata", "base.taskrc"), nil)
	if err != nil {
		t.Fatalf("parseTaskrc: %v", err)
	}

	cases := map[string]origin{
		"data.location": {source: "taskrc", value: "/home/user/.task"},
		"color":         {source: "taskrc", value: "on"},
		// Whitespace around `=` must be stripped from key and value.
		"sort": {source: "taskrc", value: "priority-,due+"},
		// Values from an included file are attributed to that file.
		"color.active": {source: "include:colors.theme", value: "rgb555 on rgb410"},
		"color.due":    {source: "include:colors.theme", value: "red"},
		// A key that merely starts with "include" is an ordinary setting.
		"includes.notadirective": {source: "taskrc", value: "1"},
	}
	for key, want := range cases {
		got, ok := origins[key]
		if !ok {
			t.Errorf("%s missing from origins", key)
			continue
		}
		if got != want {
			t.Errorf("%s = %+v, want %+v", key, got, want)
		}
	}

	if _, ok := origins["A comment line"]; ok {
		t.Error("comment line was parsed as a setting")
	}

	// An include that cannot be located is reported, not fatal.
	if len(unresolved) != 1 || unresolved[0] != "/nonexistent/missing.theme" {
		t.Errorf("unresolved = %v, want [/nonexistent/missing.theme]", unresolved)
	}
}

func TestParseTaskrcTerminatesOnIncludeCycle(t *testing.T) {
	origins, _, err := parseTaskrc(filepath.Join("testdata", "cycle-a.taskrc"), nil)
	if err != nil {
		t.Fatalf("parseTaskrc: %v", err)
	}
	if origins["a"].value != "1" || origins["b"].value != "2" {
		t.Errorf("origins = %+v, want a=1 and b=2", origins)
	}
}

func TestParseTaskrcMissingFileIsAnError(t *testing.T) {
	if _, _, err := parseTaskrc(filepath.Join("testdata", "does-not-exist"), nil); err == nil {
		t.Error("expected an error for a missing rc file")
	}
}

func TestIncludeTarget(t *testing.T) {
	cases := []struct {
		line   string
		target string
		ok     bool
	}{
		{"include default.theme", "default.theme", true},
		{"include=default.theme", "default.theme", true},
		{"include   spaced.theme", "spaced.theme", true},
		{"includes.foo=1", "", false},
		{"include", "", false},
		{"include ", "", false},
		{"color=on", "", false},
	}
	for _, c := range cases {
		target, ok := includeTarget(c.line)
		if ok != c.ok || target != c.target {
			t.Errorf("includeTarget(%q) = (%q, %v), want (%q, %v)", c.line, target, ok, c.target, c.ok)
		}
	}
}

func TestResolveIncludePrefersIncludingDirectory(t *testing.T) {
	path, ok := resolveInclude("colors.theme", "testdata", []string{"/nonexistent"})
	if !ok {
		t.Fatal("colors.theme should resolve relative to the including file")
	}
	if filepath.Base(path) != "colors.theme" {
		t.Errorf("resolved to %q", path)
	}
}

func TestResolveIncludeFallsBackToSearchDirs(t *testing.T) {
	if _, ok := resolveInclude("colors.theme", "/nonexistent", []string{"testdata"}); !ok {
		t.Error("colors.theme should resolve from the search directories")
	}
}
