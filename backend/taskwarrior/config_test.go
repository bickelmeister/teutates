package taskwarrior

import (
	"strings"
	"testing"
)

func TestParseShow(t *testing.T) {
	input := strings.Join([]string{
		"_forcecolor=0",
		"color=off",
		"sort=priority-,due+",
		"report.list.labels=ID,Start,Fällig",
		"empty=",
		"garbage line without separator",
		"",
	}, "\n")

	values, err := parseShow(strings.NewReader(input))
	if err != nil {
		t.Fatalf("parseShow: %v", err)
	}

	want := map[string]string{
		"_forcecolor":        "0",
		"color":              "off",
		"sort":               "priority-,due+",
		"report.list.labels": "ID,Start,Fällig",
		"empty":              "",
	}
	if len(values) != len(want) {
		t.Fatalf("got %d values, want %d: %v", len(values), len(want), values)
	}
	for key, expected := range want {
		if values[key] != expected {
			t.Errorf("%s = %q, want %q", key, values[key], expected)
		}
	}
}

// A value containing '=' must keep everything after the first separator.
func TestParseShowValueWithEquals(t *testing.T) {
	values, err := parseShow(strings.NewReader("alias.x=rc.verbose=nothing"))
	if err != nil {
		t.Fatalf("parseShow: %v", err)
	}
	if got := values["alias.x"]; got != "rc.verbose=nothing" {
		t.Errorf("alias.x = %q, want %q", got, "rc.verbose=nothing")
	}
}

func TestGroupOf(t *testing.T) {
	cases := map[string]string{
		"color.active":       "color",
		"report.list.labels": "report",
		"sort":               generalGroup,
		"_forcecolor":        generalGroup,
		".leading":           generalGroup,
	}
	for key, want := range cases {
		if got := groupOf(key); got != want {
			t.Errorf("groupOf(%q) = %q, want %q", key, got, want)
		}
	}
}

func TestGroupLessKeepsGeneralFirst(t *testing.T) {
	if !groupLess(generalGroup, "alias") {
		t.Error("general should sort before alias")
	}
	if groupLess("alias", generalGroup) {
		t.Error("alias should not sort before general")
	}
	if !groupLess("alias", "color") {
		t.Error("alias should sort before color")
	}
}

func TestBuildMarksOriginsAndDivergence(t *testing.T) {
	effective := map[string]string{
		"color":     "off", // resolved to off without a TTY
		"sort":      "priority-,due+",
		"color.due": "red",
		"bulk":      "3", // untouched default
	}
	origins := map[string]origin{
		"color":     {source: "taskrc", value: "on"},
		"sort":      {source: "taskrc", value: "priority-,due+"},
		"color.due": {source: "include:colors.theme", value: "red"},
	}

	config := build(effective, origins, "/home/user/.taskrc", "3.5.0", nil, nil)

	byKey := make(map[string]Setting, len(config.Settings))
	for _, setting := range config.Settings {
		byKey[setting.Key] = setting
	}

	// A TTY-dependent key keeps both the effective and the configured value.
	if got := byKey["color"]; got.Value != "off" || got.ConfiguredValue != "on" || !got.IsOverride {
		t.Errorf("color = %+v, want value=off configured=on override=true", got)
	}
	// Matching values must not report a spurious divergence.
	if got := byKey["sort"]; got.ConfiguredValue != "" {
		t.Errorf("sort.ConfiguredValue = %q, want empty", got.ConfiguredValue)
	}
	if got := byKey["color.due"]; got.Source != "include:colors.theme" {
		t.Errorf("color.due.Source = %q, want include:colors.theme", got.Source)
	}
	if got := byKey["bulk"]; got.IsOverride || got.Source != "default" {
		t.Errorf("bulk = %+v, want default and not an override", got)
	}

	// general first, then alphabetical.
	if config.Groups[0].Name != generalGroup {
		t.Errorf("first group = %q, want %q", config.Groups[0].Name, generalGroup)
	}
	if config.Groups[0].Count != 3 {
		t.Errorf("general count = %d, want 3", config.Groups[0].Count)
	}
}

func TestBuildSortsSettingsByGroupThenKey(t *testing.T) {
	config := build(map[string]string{
		"color.due":    "red",
		"color.active": "blue",
		"zebra":        "1",
		"alias.rm":     "delete",
	}, nil, "", "", nil, nil)

	var keys []string
	for _, setting := range config.Settings {
		keys = append(keys, setting.Key)
	}
	want := []string{"zebra", "alias.rm", "color.active", "color.due"}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("settings order = %v, want %v", keys, want)
		}
	}
}

func TestParseVersion(t *testing.T) {
	if got := parseVersion("3.5.0\n\nsome trailing notice\n"); got != "3.5.0" {
		t.Errorf("parseVersion = %q, want 3.5.0", got)
	}
}

// A key present in the rc file but unknown to Taskwarrior has no effect, so
// the UI needs to be able to say so.
func TestBuildMarksUnrecognizedKeys(t *testing.T) {
	config := build(
		map[string]string{"sort": "priority-,due+", "bulk": "3"},
		map[string]origin{"sort": {source: "taskrc", value: "priority-,due+"}},
		"/home/user/.taskrc", "3.5.0", nil, []string{"sort"},
	)

	byKey := make(map[string]Setting, len(config.Settings))
	for _, setting := range config.Settings {
		byKey[setting.Key] = setting
	}

	if !byKey["sort"].Unrecognized {
		t.Error("sort should be marked unrecognized")
	}
	if byKey["bulk"].Unrecognized {
		t.Error("bulk is a real setting and must not be marked")
	}
	if len(config.UnrecognizedKeys) != 1 || config.UnrecognizedKeys[0] != "sort" {
		t.Errorf("UnrecognizedKeys = %v", config.UnrecognizedKeys)
	}
}
